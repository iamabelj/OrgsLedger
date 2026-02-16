// ============================================================
// OrgsLedger API — Webhook Controller
// Concrete webhook processors for Stripe, Paystack, Flutterwave.
// Extends the abstract WebhookProcessor to eliminate duplicated logic.
// ============================================================

import { Request, Response } from 'express';
import { WebhookProcessor, WebhookResult } from '../services/webhook-processor';
import { config } from '../config';
import { paystackService } from '../services/paystack.service';
import { flutterwaveService } from '../services/flutterwave.service';
import { logger } from '../logger';
import db from '../db';
import { TX_STATUS } from '../constants';

// Cache Stripe instance
let stripe: any = null;
async function getStripe() {
  if (!stripe && config.stripe.secretKey) {
    const Stripe = (await import('stripe')).default;
    stripe = new Stripe(config.stripe.secretKey, { apiVersion: '2024-04-10' as any });
  }
  return stripe;
}

// ── Stripe ──────────────────────────────────────────────────

class StripeWebhookProcessor extends WebhookProcessor {
  protected readonly gatewayName = 'stripe';

  protected verifySignature(_req: Request): boolean {
    // Stripe signature is verified during event construction in extractPaymentData
    return true;
  }

  protected extractPaymentData(req: Request): WebhookResult | null {
    // Stripe event construction happens here because it's tightly
    // coupled with signature verification (constructEvent does both).
    const event = (req as any).__stripeEvent;
    if (!event) return null;

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      return {
        transactionId: pi.metadata?.transactionId,
        gatewayReference: pi.id,
        paymentMethod: 'card',
      };
    }

    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object;
      return {
        transactionId: pi.metadata?.transactionId,
        // Returning the ID but no gatewayReference triggers the "failed" path
      };
    }

    return null; // Ignore other event types
  }

  /** Override process to handle Stripe-specific construction */
  async process(req: Request, res: Response): Promise<void> {
    try {
      const stripeClient = await getStripe();
      if (!stripeClient) {
        res.status(503).send('Stripe not configured');
        return;
      }

      const sig = req.headers['stripe-signature'] as string;
      try {
        (req as any).__stripeEvent = stripeClient.webhooks.constructEvent(
          req.body,
          sig,
          config.stripe.webhookSecret,
        );
      } catch (err: any) {
        logger.error('Stripe signature verification failed', err.message);
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
      }

      const event = (req as any).__stripeEvent;

      // Handle failed payments separately
      if (event.type === 'payment_intent.payment_failed') {
        const pi = event.data.object;
        const txId = pi.metadata?.transactionId;
        if (txId) {
          await db('transactions')
            .where({ id: txId })
            .update({ status: TX_STATUS.FAILED });
        }
        res.json({ received: true });
        return;
      }

      // Delegate to base class for success path
      await super.process(req, res);
    } catch (err) {
      logger.error('Stripe webhook error', err);
      res.status(500).send('Webhook handler failed');
    }
  }
}

// ── Paystack ────────────────────────────────────────────────

class PaystackWebhookProcessor extends WebhookProcessor {
  protected readonly gatewayName = 'paystack';

  protected verifySignature(req: Request): boolean {
    const sig = req.headers['x-paystack-signature'] as string;
    const rawBody =
      typeof req.body === 'string'
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : JSON.stringify(req.body);
    return paystackService.validateWebhook(rawBody, sig);
  }

  protected extractPaymentData(req: Request): WebhookResult | null {
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (event.event !== 'charge.success') return null;

    const data = event.data;
    const meta = data.metadata;
    return {
      transactionId: meta?.transactionId,
      userId: meta?.userId,
      organizationId: meta?.organizationId,
      gatewayReference: data.reference,
      paymentMethod: data.channel || 'card',
    };
  }
}

// ── Flutterwave ─────────────────────────────────────────────

class FlutterwaveWebhookProcessor extends WebhookProcessor {
  protected readonly gatewayName = 'flutterwave';

  protected verifySignature(req: Request): boolean {
    const secretHash = req.headers['verif-hash'] as string;
    return flutterwaveService.validateWebhook(secretHash);
  }

  protected extractPaymentData(req: Request): WebhookResult | null {
    const payload = req.body;
    if (payload.event !== 'charge.completed' || payload.data?.status !== 'successful') {
      return null;
    }

    const data = payload.data;
    return {
      transactionId: undefined, // Flutterwave uses tx_ref lookup
      gatewayReference: data.tx_ref,
      paymentMethod: data.payment_type || 'card',
    };
  }

  /** Override — Flutterwave looks up tx by gateway_id (tx_ref) not metadata */
  async process(req: Request, res: Response): Promise<void> {
    try {
      if (!this.verifySignature(req)) {
        res.status(401).send('Invalid hash');
        return;
      }

      const result = this.extractPaymentData(req);
      if (!result) {
        res.status(200).send('ok');
        return;
      }

      // Flutterwave uses tx_ref as the payment_gateway_id
      const tx = await db('transactions')
        .where({ payment_gateway_id: result.gatewayReference })
        .first();

      if (!tx || tx.status !== TX_STATUS.PENDING) {
        res.status(200).send('ok');
        return;
      }

      // Re-use base class logic by injecting tx id
      (req as any).__txOverride = tx;
      result.transactionId = tx.id;

      // Now delegate to base
      await super.process(req, res);
    } catch (err) {
      logger.error('Flutterwave webhook error', err);
      res.status(500).send('Webhook handler failed');
    }
  }
}

// ── Exported singletons ─────────────────────────────────────

export const stripeWebhook = new StripeWebhookProcessor();
export const paystackWebhook = new PaystackWebhookProcessor();
export const flutterwaveWebhook = new FlutterwaveWebhookProcessor();

/** Convenience namespace for route wiring */
export class WebhookController {
  static stripe = stripeWebhook;
  static paystack = paystackWebhook;
  static flutterwave = flutterwaveWebhook;
}

export const webhookController = new WebhookController();
