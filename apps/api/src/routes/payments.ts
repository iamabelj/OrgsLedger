// ============================================================
// OrgsLedger API — Payments Routes
// Stripe integration, receipts, refunds
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { authenticate, loadMembershipAndSub as loadMembership, requireRole, validate } from '../middleware';
import { config } from '../config';
import { logger } from '../logger';
import { paystackService } from '../services/paystack.service';
import { flutterwaveService } from '../services/flutterwave.service';
import { emitFinancialUpdate } from '../socket';
import { sendPushToUser } from '../services/push.service';

const router = Router();

// ── Safe cents conversion to avoid float precision issues ────
function toSubunits(amount: number): number {
  // Multiply by 100 using string arithmetic to avoid float issues
  const [whole = '0', frac = ''] = String(amount).split('.');
  const paddedFrac = (frac + '00').slice(0, 2);
  return parseInt(whole, 10) * 100 + parseInt(paddedFrac, 10);
}

// ── Initialize Stripe ───────────────────────────────────────
let stripe: any = null;
async function getStripe() {
  if (!stripe && config.stripe.secretKey) {
    const Stripe = (await import('stripe')).default;
    stripe = new Stripe(config.stripe.secretKey);
  }
  return stripe;
}

// ── Schemas ─────────────────────────────────────────────────
const payTransactionSchema = z.object({
  transactionId: z.string().uuid(),
  gateway: z.enum(['stripe', 'paystack', 'flutterwave', 'bank_transfer']).default('stripe'),
  paymentMethodId: z.string().optional(), // Stripe payment method
  proofOfPayment: z.string().optional(),  // For bank transfer — reference/receipt
});

const purchaseCreditsSchema = z.object({
  credits: z.number().int().min(1), // minimum 1 credit (= 1 hour)
});

const refundSchema = z.object({
  transactionId: z.string().uuid(),
  amount: z.number().positive().max(999_999_999).optional(),
  reason: z.string().max(500).optional(),
});

const approveTransferSchema = z.object({
  transactionId: z.string().uuid(),
  approved: z.boolean(),
});

// ── Pay a Transaction ───────────────────────────────────────
router.post(
  '/:orgId/payments/pay',
  authenticate,
  loadMembership,
  validate(payTransactionSchema),
  async (req: Request, res: Response) => {
    try {
      const { transactionId, gateway, paymentMethodId } = req.body;

      const transaction = await db('transactions')
        .where({
          id: transactionId,
          organization_id: req.params.orgId,
          user_id: req.user!.userId,
          status: 'pending',
        })
        .first();

      if (!transaction) {
        res.status(404).json({ success: false, error: 'Transaction not found or already processed' });
        return;
      }

      const user = await db('users').where({ id: req.user!.userId }).select('email', 'first_name', 'last_name').first();

      // ─── STRIPE ─────────────────────────────────────────
      if (gateway === 'stripe') {
        const stripeClient = await getStripe();

        if (stripeClient && paymentMethodId) {
          const paymentIntent = await stripeClient.paymentIntents.create({
            amount: toSubunits(transaction.amount),
            currency: transaction.currency.toLowerCase(),
            payment_method: paymentMethodId,
            confirm: true,
            automatic_payment_methods: {
              enabled: true,
              allow_redirects: 'never',
            },
            metadata: {
              transactionId: transaction.id,
              organizationId: req.params.orgId,
              userId: req.user!.userId,
            },
          });

          if (paymentIntent.status === 'succeeded') {
            await markTransactionCompleted(transaction, paymentIntent.id, 'card', 'stripe');

            await sendPaymentNotification(req, transaction, paymentIntent.id);

            res.json({
              success: true,
              data: {
                transactionId,
                gateway: 'stripe',
                status: 'completed',
                receiptUrl: paymentIntent.charges?.data?.[0]?.receipt_url,
              },
            });
          } else {
            res.status(402).json({
              success: false,
              error: 'Payment requires further action',
              data: { clientSecret: paymentIntent.client_secret },
            });
          }
        } else {
          // Stripe not configured — dev mode fallback
          await devModeFallback(req, transaction);
          res.json({
            success: true,
            data: { transactionId, gateway: 'stripe', status: 'completed', note: 'Dev mode — Stripe not configured' },
          });
        }
        return;
      }

      // ─── PAYSTACK ───────────────────────────────────────
      if (gateway === 'paystack') {
        if (!paystackService.isConfigured()) {
          await devModeFallback(req, transaction);
          res.json({
            success: true,
            data: { transactionId, gateway: 'paystack', status: 'completed', note: 'Dev mode — Paystack not configured' },
          });
          return;
        }

        const reference = `orgsl_${transactionId.replace(/-/g, '').slice(0, 16)}_${Date.now()}`;
        const result = await paystackService.initializeTransaction({
          email: user?.email || 'user@orgsledger.com',
          amount: toSubunits(transaction.amount), // subunit
          currency: transaction.currency,
          reference,
          metadata: {
            transactionId: transaction.id,
            organizationId: req.params.orgId,
            userId: req.user!.userId,
          },
        });

        // Store reference for verification
        await db('transactions')
          .where({ id: transactionId })
          .update({ payment_gateway_id: reference, payment_method: 'paystack_pending' });

        res.json({
          success: true,
          data: {
            transactionId,
            gateway: 'paystack',
            status: 'pending',
            authorizationUrl: result.authorizationUrl,
            reference: result.reference,
          },
        });
        return;
      }

      // ─── FLUTTERWAVE ───────────────────────────────────
      if (gateway === 'flutterwave') {
        if (!flutterwaveService.isConfigured()) {
          await devModeFallback(req, transaction);
          res.json({
            success: true,
            data: { transactionId, gateway: 'flutterwave', status: 'completed', note: 'Dev mode — Flutterwave not configured' },
          });
          return;
        }

        const txRef = `orgsl_${transactionId.replace(/-/g, '').slice(0, 16)}_${Date.now()}`;
        const result = await flutterwaveService.initializePayment({
          txRef,
          amount: transaction.amount,
          currency: transaction.currency,
          customerEmail: user?.email || 'user@orgsledger.com',
          customerName: `${user?.first_name || ''} ${user?.last_name || ''}`.trim(),
          meta: {
            transactionId: transaction.id,
            organizationId: req.params.orgId,
            userId: req.user!.userId,
          },
          description: transaction.description,
        });

        await db('transactions')
          .where({ id: transactionId })
          .update({ payment_gateway_id: txRef, payment_method: 'flutterwave_pending' });

        res.json({
          success: true,
          data: {
            transactionId,
            gateway: 'flutterwave',
            status: 'pending',
            paymentLink: result.paymentLink,
            txRef: result.txRef,
          },
        });
        return;
      }

      // ─── BANK TRANSFER ─────────────────────────────────
      if (gateway === 'bank_transfer') {
        const { proofOfPayment } = req.body;

        // Mark as awaiting_approval (admin must manually approve)
        await db('transactions')
          .where({ id: transactionId })
          .update({
            payment_method: 'bank_transfer',
            payment_gateway_id: proofOfPayment || null,
            status: 'awaiting_approval',
          });

        // Notify org admin(s)
        const admins = await db('memberships')
          .where({ organization_id: req.params.orgId, role: 'org_admin', is_active: true })
          .pluck('user_id');

        for (const adminId of admins) {
          await db('notifications').insert({
            user_id: adminId,
            organization_id: req.params.orgId,
            type: 'payment',
            title: 'Bank Transfer Pending Approval',
            body: `${user?.first_name || 'A member'} submitted bank transfer of ${transaction.currency} ${transaction.amount}. Proof: ${proofOfPayment || 'Not provided'}`,
            data: JSON.stringify({ transactionId, type: 'bank_transfer_approval' }),
          });
          sendPushToUser(adminId, {
            title: 'Bank Transfer Pending',
            body: `${user?.first_name || 'A member'} submitted a bank transfer for ${transaction.currency} ${transaction.amount}. Awaiting your approval.`,
            data: { transactionId, type: 'bank_transfer_approval' },
          }).catch(() => {});
        }

        res.json({
          success: true,
          data: {
            transactionId,
            gateway: 'bank_transfer',
            status: 'awaiting_approval',
            message: 'Bank transfer submitted. Admin will review and approve your payment.',
          },
        });
        return;
      }

      res.status(400).json({ success: false, error: 'Unsupported gateway' });
    } catch (err: any) {
      logger.error('Payment error', err);
      res.status(500).json({ success: false, error: err.message || 'Payment failed' });
    }
  }
);

// ── Helper: mark transaction completed ──────────────────────
async function markTransactionCompleted(
  transaction: any,
  gatewayId: string,
  paymentMethod: string,
  gateway: string
) {
  await db('transactions')
    .where({ id: transaction.id })
    .update({
      status: 'completed',
      payment_gateway_id: gatewayId,
      payment_method: `${gateway}_${paymentMethod}`,
    });

  if (transaction.reference_type === 'fine') {
    await db('fines').where({ id: transaction.reference_id }).update({ status: 'paid' });
  }
  if (transaction.reference_type === 'donation') {
    await db('donations').where({ id: transaction.reference_id }).update({ status: 'completed' });
  }
}

async function sendPaymentNotification(req: Request, transaction: any, gatewayId: string) {
  await (req as any).audit?.({
    organizationId: req.params.orgId,
    action: 'payment',
    entityType: 'transaction',
    entityId: transaction.id,
    newValue: {
      amount: transaction.amount,
      gatewayId,
      status: 'completed',
    },
  });

  await db('notifications').insert({
    user_id: req.user!.userId,
    organization_id: req.params.orgId,
    type: 'payment',
    title: 'Payment Successful',
    body: `Payment of ${transaction.currency} ${transaction.amount} confirmed.`,
    data: JSON.stringify({ transactionId: transaction.id }),
  });

  // Push notification
  sendPushToUser(req.user!.userId, {
    title: 'Payment Successful',
    body: `Payment of ${transaction.currency} ${transaction.amount} confirmed.`,
    data: { transactionId: transaction.id, type: 'payment' },
  }).catch(() => {});

  // Real-time ledger update
  const io = req.app.get('io');
  if (io) {
    emitFinancialUpdate(io, req.params.orgId, {
      type: 'payment_completed',
      transactionId: transaction.id,
      amount: transaction.amount,
      currency: transaction.currency,
      userId: req.user!.userId,
    });
  }
}

async function devModeFallback(req: Request, transaction: any) {
  // CRITICAL: Only allow dev-mode auto-completion in explicit development environment
  if (config.env !== 'development') {
    throw new Error('Payment gateway not configured. Contact administrator.');
  }

  await db('transactions')
    .where({ id: transaction.id })
    .update({
      status: 'completed',
      payment_method: 'dev_mode',
    });

  if (transaction.reference_type === 'fine') {
    await db('fines').where({ id: transaction.reference_id }).update({ status: 'paid' });
  }
  if (transaction.reference_type === 'donation') {
    await db('donations').where({ id: transaction.reference_id }).update({ status: 'completed' });
  }

  await (req as any).audit?.({
    organizationId: req.params.orgId,
    action: 'payment',
    entityType: 'transaction',
    entityId: transaction.id,
    newValue: { amount: transaction.amount, status: 'completed', mode: 'dev' },
  });
}

// ── Create Stripe Setup Intent ──────────────────────────────
router.post(
  '/:orgId/payments/setup-intent',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const stripeClient = await getStripe();
      if (!stripeClient) {
        res.status(503).json({ success: false, error: 'Stripe not configured' });
        return;
      }

      const setupIntent = await stripeClient.setupIntents.create({
        metadata: {
          userId: req.user!.userId,
          organizationId: req.params.orgId,
        },
      });

      res.json({
        success: true,
        data: { clientSecret: setupIntent.client_secret },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to create setup intent' });
    }
  }
);

// ── Request Refund ──────────────────────────────────────────
router.post(
  '/:orgId/payments/refund',
  authenticate,
  loadMembership,
  requireRole('org_admin'),
  validate(refundSchema),
  async (req: Request, res: Response) => {
    try {
      const { transactionId, amount, reason } = req.body;

      const transaction = await db('transactions')
        .where({
          id: transactionId,
          organization_id: req.params.orgId,
          status: 'completed',
        })
        .first();

      if (!transaction) {
        res.status(404).json({ success: false, error: 'Completed transaction not found' });
        return;
      }

      const refundAmount = amount || transaction.amount;
      if (refundAmount > transaction.amount) {
        res.status(400).json({ success: false, error: 'Refund amount exceeds transaction amount' });
        return;
      }

      let gatewayRefundId = null;
      const paymentMethod = transaction.payment_method || '';

      if (paymentMethod.startsWith('stripe') || (!paymentMethod.startsWith('paystack') && !paymentMethod.startsWith('flutterwave'))) {
        // Stripe refund
        const stripeClient = await getStripe();
        if (stripeClient && transaction.payment_gateway_id) {
          const refund = await stripeClient.refunds.create({
            payment_intent: transaction.payment_gateway_id,
            amount: toSubunits(refundAmount),
          });
          gatewayRefundId = refund.id;
        }
      } else if (paymentMethod.startsWith('paystack')) {
        // Paystack refund
        if (paystackService.isConfigured() && transaction.payment_gateway_id) {
          const result = await paystackService.createRefund({
            transactionReference: transaction.payment_gateway_id,
            amount: toSubunits(refundAmount),
            reason: reason || 'Admin refund',
          });
          gatewayRefundId = result.refundId;
        }
      } else if (paymentMethod.startsWith('flutterwave')) {
        // Flutterwave refund
        if (flutterwaveService.isConfigured() && transaction.payment_gateway_id) {
          const result = await flutterwaveService.createRefund({
            transactionId: transaction.payment_gateway_id,
            amount: refundAmount,
            reason: reason || 'Admin refund',
          });
          gatewayRefundId = result.refundId;
        }
      }

      // Create refund record
      const [refund] = await db('refunds')
        .insert({
          transaction_id: transactionId,
          amount: refundAmount,
          reason: reason || 'Admin refund',
          status: 'completed',
          payment_gateway_refund_id: gatewayRefundId,
          processed_by: req.user!.userId,
        })
        .returning('*');

      // Update transaction status
      const newStatus =
        refundAmount >= transaction.amount ? 'refunded' : 'partially_refunded';
      await db('transactions')
        .where({ id: transactionId })
        .update({ status: newStatus });

      // Create refund transaction in ledger
      await db('transactions').insert({
        organization_id: req.params.orgId,
        user_id: transaction.user_id,
        type: 'refund',
        amount: -refundAmount,
        currency: transaction.currency,
        status: 'completed',
        description: `Refund for: ${transaction.description}`,
        reference_id: refund.id,
        reference_type: 'refund',
        payment_gateway_id: gatewayRefundId,
      });

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'refund',
        entityType: 'transaction',
        entityId: transactionId,
        newValue: { refundAmount, reason, refundId: refund.id },
      });

      // Notify user
      await db('notifications').insert({
        user_id: transaction.user_id,
        organization_id: req.params.orgId,
        type: 'payment',
        title: 'Refund Processed',
        body: `A refund of ${transaction.currency} ${refundAmount} has been processed.`,
        data: JSON.stringify({ refundId: refund.id }),
      });

      // Push notification for refund
      sendPushToUser(transaction.user_id, {
        title: 'Refund Processed',
        body: `A refund of ${transaction.currency} ${refundAmount} has been processed.`,
        data: { refundId: refund.id, type: 'refund' },
      }).catch(() => {});

      // Real-time ledger update for refund
      const io = req.app.get('io');
      if (io) {
        emitFinancialUpdate(io, req.params.orgId, {
          type: 'refund_completed',
          transactionId,
          refundId: refund.id,
          amount: refundAmount,
          currency: transaction.currency,
          userId: transaction.user_id,
        });
      }

      res.json({ success: true, data: refund });
    } catch (err) {
      logger.error('Refund error', err);
      res.status(500).json({ success: false, error: 'Failed to process refund' });
    }
  }
);

// ── Stripe Webhook ──────────────────────────────────────────
router.post('/webhooks/stripe', async (req: Request, res: Response) => {
  try {
    const stripeClient = await getStripe();
    if (!stripeClient) {
      res.status(503).send('Stripe not configured');
      return;
    }

    const sig = req.headers['stripe-signature'] as string;
    let event;

    try {
      event = stripeClient.webhooks.constructEvent(
        req.body,
        sig,
        config.stripe.webhookSecret
      );
    } catch (err: any) {
      logger.error('Webhook signature verification failed', err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        const txId = paymentIntent.metadata?.transactionId;
        if (txId) {
          const tx = await db('transactions').where({ id: txId }).first();
          if (tx && tx.status !== 'completed') {
            await markTransactionCompleted(tx, paymentIntent.id, 'card', 'stripe');

            // Send notifications for async confirmations (e.g. 3D Secure)
            await db('notifications').insert({
              user_id: tx.user_id,
              organization_id: tx.organization_id,
              type: 'payment',
              title: 'Payment Successful',
              body: `Payment of ${tx.currency} ${tx.amount} confirmed.`,
              data: JSON.stringify({ transactionId: tx.id }),
            });

            sendPushToUser(tx.user_id, {
              title: 'Payment Successful',
              body: `Payment of ${tx.currency} ${tx.amount} confirmed.`,
              data: { transactionId: tx.id, type: 'payment' },
            }).catch(() => {});

            const io = req.app.get('io');
            if (io) {
              emitFinancialUpdate(io, tx.organization_id, {
                type: 'payment_completed',
                transactionId: tx.id,
                amount: tx.amount,
                currency: tx.currency,
                userId: tx.user_id,
              });
            }
          }
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        const txId = paymentIntent.metadata?.transactionId;
        if (txId) {
          await db('transactions')
            .where({ id: txId })
            .update({ status: 'failed' });
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error('Webhook error', err);
    res.status(500).send('Webhook handler failed');
  }
});

// ── Paystack Webhook ────────────────────────────────────────
router.post('/webhooks/paystack', async (req: Request, res: Response) => {
  try {
    const sig = req.headers['x-paystack-signature'] as string;
    const rawBody = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);

    if (!paystackService.validateWebhook(rawBody, sig)) {
      res.status(400).send('Invalid signature');
      return;
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (event.event === 'charge.success') {
      const paymentData = event.data;
      const reference = paymentData.reference;
      const meta = paymentData.metadata;

      if (meta?.transactionId) {
        await db('transactions')
          .where({ id: meta.transactionId, status: 'pending' })
          .update({
            status: 'completed',
            payment_gateway_id: reference,
            payment_method: `paystack_${paymentData.channel || 'card'}`,
          });

        // Update related records
        const tx = await db('transactions').where({ id: meta.transactionId }).first();
        if (tx?.reference_type === 'fine') {
          await db('fines').where({ id: tx.reference_id }).update({ status: 'paid' });
        }
        if (tx?.reference_type === 'donation') {
          await db('donations').where({ id: tx.reference_id }).update({ status: 'completed' });
        }

        await db('notifications').insert({
          user_id: meta.userId,
          organization_id: meta.organizationId,
          type: 'payment',
          title: 'Payment Successful',
          body: `Your Paystack payment has been confirmed.`,
          data: JSON.stringify({ transactionId: meta.transactionId }),
        });

        // Push notification for Paystack payment
        sendPushToUser(meta.userId, {
          title: 'Payment Successful',
          body: 'Your Paystack payment has been confirmed.',
          data: { transactionId: meta.transactionId, type: 'payment' },
        }).catch(() => {});

        // Real-time ledger update
        const io = req.app.get('io');
        if (io && meta.organizationId) {
          emitFinancialUpdate(io, meta.organizationId, {
            type: 'payment_completed',
            transactionId: meta.transactionId,
            userId: meta.userId,
          });
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error('Paystack webhook error', err);
    res.status(500).send('Webhook handler failed');
  }
});

// ── Paystack callback (redirect after payment) ─────────────
router.get('/paystack/callback', async (req: Request, res: Response) => {
  try {
    const reference = req.query.reference as string;
    if (!reference) {
      res.status(400).send('Missing reference');
      return;
    }

    const result = await paystackService.verifyTransaction(reference);

    if (result.status === 'success') {
      // Find transaction by gateway_id
      const tx = await db('transactions')
        .where({ payment_gateway_id: reference })
        .first();

      if (tx && tx.status === 'pending') {
        await db('transactions')
          .where({ id: tx.id })
          .update({
            status: 'completed',
            payment_method: `paystack_${result.channel}`,
          });

        if (tx.reference_type === 'fine') {
          await db('fines').where({ id: tx.reference_id }).update({ status: 'paid' });
        }
        if (tx.reference_type === 'donation') {
          await db('donations').where({ id: tx.reference_id }).update({ status: 'completed' });
        }
      }
    }

    // Redirect to mobile deep link
    res.redirect(`orgsledger://payment-complete?reference=${reference}&status=${result.status}`);
  } catch (err) {
    logger.error('Paystack callback error', err);
    res.redirect('orgsledger://payment-complete?status=error');
  }
});

// ── Flutterwave Webhook ─────────────────────────────────────
router.post('/webhooks/flutterwave', async (req: Request, res: Response) => {
  try {
    const secretHash = req.headers['verif-hash'] as string;
    if (!flutterwaveService.validateWebhook(secretHash)) {
      res.status(401).send('Invalid hash');
      return;
    }

    const payload = req.body;

    if (payload.event === 'charge.completed' && payload.data?.status === 'successful') {
      const txRef = payload.data.tx_ref;
      const meta = payload.data.meta;

      const tx = await db('transactions')
        .where({ payment_gateway_id: txRef })
        .first();

      if (tx && tx.status === 'pending') {
        await db('transactions')
          .where({ id: tx.id })
          .update({
            status: 'completed',
            payment_method: `flutterwave_${payload.data.payment_type || 'card'}`,
          });

        if (tx.reference_type === 'fine') {
          await db('fines').where({ id: tx.reference_id }).update({ status: 'paid' });
        }
        if (tx.reference_type === 'donation') {
          await db('donations').where({ id: tx.reference_id }).update({ status: 'completed' });
        }

        await db('notifications').insert({
          user_id: tx.user_id,
          organization_id: tx.organization_id,
          type: 'payment',
          title: 'Payment Successful',
          body: `Your Flutterwave payment has been confirmed.`,
          data: JSON.stringify({ transactionId: tx.id }),
        });

        // Push notification for Flutterwave payment
        sendPushToUser(tx.user_id, {
          title: 'Payment Successful',
          body: 'Your Flutterwave payment has been confirmed.',
          data: { transactionId: tx.id, type: 'payment' },
        }).catch(() => {});

        // Real-time ledger update
        const io = req.app.get('io');
        if (io) {
          emitFinancialUpdate(io, tx.organization_id, {
            type: 'payment_completed',
            transactionId: tx.id,
            amount: tx.amount,
            currency: tx.currency,
            userId: tx.user_id,
          });
        }
      }
    }

    res.status(200).send('ok');
  } catch (err) {
    logger.error('Flutterwave webhook error', err);
    res.status(500).send('Webhook handler failed');
  }
});

// ── Flutterwave callback (redirect after payment) ──────────
router.get('/flutterwave/callback', async (req: Request, res: Response) => {
  try {
    const txRef = req.query.tx_ref as string;
    const flwTransactionId = req.query.transaction_id as string;

    if (!flwTransactionId || !txRef) {
      res.redirect('orgsledger://payment-complete?status=error');
      return;
    }

    const result = await flutterwaveService.verifyTransaction(flwTransactionId);

    if (result.status === 'successful') {
      const tx = await db('transactions')
        .where({ payment_gateway_id: txRef })
        .first();

      if (tx && tx.status === 'pending') {
        await db('transactions')
          .where({ id: tx.id })
          .update({
            status: 'completed',
            payment_method: `flutterwave_${result.paymentType}`,
          });

        if (tx.reference_type === 'fine') {
          await db('fines').where({ id: tx.reference_id }).update({ status: 'paid' });
        }
        if (tx.reference_type === 'donation') {
          await db('donations').where({ id: tx.reference_id }).update({ status: 'completed' });
        }
      }
    }

    res.redirect(`orgsledger://payment-complete?tx_ref=${txRef}&status=${result.status}`);
  } catch (err) {
    logger.error('Flutterwave callback error', err);
    res.redirect('orgsledger://payment-complete?status=error');
  }
});

// ── Available Gateways (org-configurable + bank_transfer) ───
router.get(
  '/:orgId/payments/gateways',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    let orgMethods: any = null;
    try {
      const org = await db('organizations').where({ id: req.params.orgId }).select('settings').first();
      const settings = org?.settings
        ? (typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings)
        : {};
      orgMethods = settings.payment_methods;
    } catch {}

    const gateways: any[] = [];

    if (orgMethods) {
      if (orgMethods.paystack?.enabled) {
        gateways.push({ id: 'paystack', name: orgMethods.paystack.label || 'Pay with Paystack', type: 'redirect' });
      }
      if (orgMethods.flutterwave?.enabled) {
        gateways.push({ id: 'flutterwave', name: orgMethods.flutterwave.label || 'Pay with Flutterwave', type: 'redirect' });
      }
      if (orgMethods.stripe?.enabled) {
        gateways.push({ id: 'stripe', name: orgMethods.stripe.label || 'Pay with Card', type: 'card' });
      }
      if (orgMethods.bank_transfer?.enabled) {
        gateways.push({
          id: 'bank_transfer',
          name: orgMethods.bank_transfer.label || 'Bank Transfer',
          type: 'bank_transfer',
          bankDetails: {
            bankName: orgMethods.bank_transfer.bank_name,
            accountNumber: orgMethods.bank_transfer.account_number,
            accountName: orgMethods.bank_transfer.account_name,
            instructions: orgMethods.bank_transfer.instructions,
          },
        });
      }
    } else {
      if (config.paystack.secretKey) gateways.push({ id: 'paystack', name: 'Paystack', type: 'redirect' });
      if (config.flutterwave.secretKey) gateways.push({ id: 'flutterwave', name: 'Flutterwave', type: 'redirect' });
      if (config.stripe.secretKey) gateways.push({ id: 'stripe', name: 'Stripe', type: 'card' });
    }

    if (!gateways.length) {
      gateways.push({ id: 'stripe', name: 'Dev Mode', type: 'dev' });
    }

    res.json({ success: true, data: gateways });
  }
);

// ── Verify Payment (for mobile to check status after redirect) ──
router.get(
  '/:orgId/payments/verify/:transactionId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const transaction = await db('transactions')
        .where({
          id: req.params.transactionId,
          organization_id: req.params.orgId,
          user_id: req.user!.userId,
        })
        .first();

      if (!transaction) {
        res.status(404).json({ success: false, error: 'Transaction not found' });
        return;
      }

      res.json({
        success: true,
        data: {
          transactionId: transaction.id,
          status: transaction.status,
          paymentMethod: transaction.payment_method,
          amount: transaction.amount,
          currency: transaction.currency,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to verify payment' });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// AI CREDITS
// ══════════════════════════════════════════════════════════════

router.get(
  '/:orgId/ai-credits',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const wallet = await db('ai_wallet')
        .where({ organization_id: req.params.orgId })
        .first();

      const history = await db('ai_wallet_transactions')
        .where({ organization_id: req.params.orgId })
        .orderBy('created_at', 'desc')
        .limit(50);

      res.json({
        success: true,
        data: {
          balanceMinutes: parseFloat(wallet?.balance_minutes) || 0,
          pricePerHourUsd: parseFloat(wallet?.price_per_hour_usd) || 10.00,
          pricePerHourNgn: parseFloat(wallet?.price_per_hour_ngn) || 18000.00,
          currency: wallet?.currency || 'USD',
          history,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get AI credits' });
    }
  }
);

router.post(
  '/:orgId/ai-credits/purchase',
  authenticate,
  loadMembership,
  requireRole('org_admin'),
  validate(purchaseCreditsSchema),
  async (req: Request, res: Response) => {
    try {
      const { credits: creditsToPurchase } = req.body;
      const existingCredits = await db('ai_credits')
        .where({ organization_id: req.params.orgId })
        .first();

      const pricePerCredit = existingCredits?.price_per_credit_hour || 7.00;
      const totalPrice = creditsToPurchase * pricePerCredit;

      // Create payment transaction
      const [transaction] = await db('transactions')
        .insert({
          organization_id: req.params.orgId,
          user_id: req.user!.userId,
          type: 'ai_credit_purchase',
          amount: totalPrice,
          currency: 'USD',
          status: 'pending',
          description: `AI Credits: ${creditsToPurchase} credit${creditsToPurchase > 1 ? 's' : ''} (${creditsToPurchase} hour${creditsToPurchase > 1 ? 's' : ''})`,
        })
        .returning('*');

      // In dev mode only, auto-complete (NEVER in production)
      if (!config.stripe.secretKey && config.env === 'development') {
        await db('transactions')
          .where({ id: transaction.id })
          .update({ status: 'completed' });

        // Add credits
        await db('ai_credits')
          .where({ organization_id: req.params.orgId })
          .update({
            total_credits: db.raw('total_credits + ?', [creditsToPurchase]),
          });

        await db('ai_credit_transactions').insert({
          organization_id: req.params.orgId,
          type: 'purchase',
          amount: creditsToPurchase,
          transaction_id: transaction.id,
          description: `Purchased ${creditsToPurchase} AI credit${creditsToPurchase > 1 ? 's' : ''}`,
        });

        await (req as any).audit?.({
          organizationId: req.params.orgId,
          action: 'payment',
          entityType: 'ai_credits',
          entityId: req.params.orgId,
          newValue: { credits: creditsToPurchase, totalPrice },
        });
      }

      res.status(201).json({
        success: true,
        data: {
          transactionId: transaction.id,
          creditsPurchased: creditsToPurchase,
          totalPrice,
          currency: 'USD',
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to purchase credits' });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// BANK TRANSFER — ADMIN APPROVAL
// ══════════════════════════════════════════════════════════════

// List pending bank transfers
router.get(
  '/:orgId/payments/pending-transfers',
  authenticate,
  loadMembership,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
      const transfers = await db('transactions')
        .leftJoin('users', 'transactions.user_id', 'users.id')
        .where({
          'transactions.organization_id': req.params.orgId,
          'transactions.payment_method': 'bank_transfer',
          'transactions.status': 'awaiting_approval',
        })
        .select(
          'transactions.*',
          'users.first_name',
          'users.last_name',
          'users.email'
        )
        .orderBy('transactions.created_at', 'desc');

      res.json({ success: true, data: transfers });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to load pending transfers' });
    }
  }
);

// Approve or reject bank transfer
router.post(
  '/:orgId/payments/approve-transfer',
  authenticate,
  loadMembership,
  requireRole('org_admin'),
  validate(approveTransferSchema),
  async (req: Request, res: Response) => {
    try {
      const { transactionId, approved } = req.body;

      const transaction = await db('transactions')
        .where({
          id: transactionId,
          organization_id: req.params.orgId,
          status: 'awaiting_approval',
        })
        .first();

      if (!transaction) {
        res.status(404).json({ success: false, error: 'Pending transfer not found' });
        return;
      }

      if (approved) {
        await markTransactionCompleted(
          transaction,
          transaction.payment_gateway_id || 'bank_transfer_approved',
          'bank_transfer',
          'bank'
        );

        await db('notifications').insert({
          user_id: transaction.user_id,
          organization_id: req.params.orgId,
          type: 'payment',
          title: 'Payment Approved',
          body: `Your bank transfer of ${transaction.currency} ${transaction.amount} has been approved.`,
          data: JSON.stringify({ transactionId }),
        });

        sendPushToUser(transaction.user_id, {
          title: 'Payment Approved',
          body: `Your bank transfer of ${transaction.currency} ${transaction.amount} has been approved.`,
          data: { transactionId, type: 'payment' },
        }).catch(() => {});

        const io = req.app.get('io');
        if (io) {
          emitFinancialUpdate(io, req.params.orgId, {
            type: 'payment_completed',
            transactionId,
            amount: transaction.amount,
            currency: transaction.currency,
            userId: transaction.user_id,
          });
        }
      } else {
        await db('transactions')
          .where({ id: transactionId })
          .update({ status: 'failed', payment_method: 'bank_transfer_rejected' });

        await db('notifications').insert({
          user_id: transaction.user_id,
          organization_id: req.params.orgId,
          type: 'payment',
          title: 'Payment Rejected',
          body: `Your bank transfer of ${transaction.currency} ${transaction.amount} was not approved. Please contact admin.`,
          data: JSON.stringify({ transactionId }),
        });

        sendPushToUser(transaction.user_id, {
          title: 'Payment Rejected',
          body: `Your bank transfer of ${transaction.currency} ${transaction.amount} was not approved.`,
          data: { transactionId, type: 'payment' },
        }).catch(() => {});
      }

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: approved ? 'approve' : 'reject',
        entityType: 'bank_transfer',
        entityId: transactionId,
        newValue: { approved, amount: transaction.amount },
      });

      res.json({ success: true, message: approved ? 'Transfer approved' : 'Transfer rejected' });
    } catch (err) {
      logger.error('Approve transfer error', err);
      res.status(500).json({ success: false, error: 'Failed to process approval' });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// PAYMENT METHOD CONFIGURATION (ORG ADMIN)
// ══════════════════════════════════════════════════════════════

// Get org payment methods config
router.get(
  '/:orgId/payments/methods',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const org = await db('organizations')
        .where({ id: req.params.orgId })
        .select('id', 'name', 'settings')
        .first();

      const settings = org?.settings
        ? (typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings)
        : {};
      const paymentMethods = settings.payment_methods || {
        paystack: { enabled: true, label: 'Pay with Paystack' },
        flutterwave: { enabled: true, label: 'Pay with Flutterwave' },
        stripe: { enabled: false, label: 'Pay with Card (Stripe)' },
        bank_transfer: {
          enabled: false,
          label: 'Bank Transfer',
          bank_name: '',
          account_number: '',
          account_name: '',
          instructions: 'Please transfer to the above account and submit proof of payment.',
        },
      };

      res.json({ success: true, data: paymentMethods });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get payment methods' });
    }
  }
);

// Update org payment methods config (admin only)
const paymentMethodsSchema = z.object({
  paymentMethods: z.object({
    stripe: z.object({ enabled: z.boolean() }).passthrough().optional(),
    paystack: z.object({ enabled: z.boolean() }).passthrough().optional(),
    flutterwave: z.object({ enabled: z.boolean() }).passthrough().optional(),
    bank_transfer: z.object({
      enabled: z.boolean(),
      bank_name: z.string().max(200).optional(),
      account_number: z.string().max(50).optional(),
      account_name: z.string().max(200).optional(),
      sort_code: z.string().max(20).optional(),
      instructions: z.string().max(500).optional(),
    }).optional(),
  }),
});

router.put(
  '/:orgId/payments/methods',
  authenticate,
  loadMembership,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
      const parsed = paymentMethodsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'Invalid payment methods configuration', details: parsed.error.flatten() });
        return;
      }
      const { paymentMethods } = parsed.data;

      const org = await db('organizations')
        .where({ id: req.params.orgId })
        .select('settings')
        .first();

      const settings = org?.settings
        ? (typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings)
        : {};
      settings.payment_methods = paymentMethods;

      await db('organizations')
        .where({ id: req.params.orgId })
        .update({ settings: JSON.stringify(settings) });

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'update',
        entityType: 'payment_methods',
        entityId: req.params.orgId,
        newValue: paymentMethods,
      });

      res.json({ success: true, message: 'Payment methods updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to update payment methods' });
    }
  }
);

export default router;
