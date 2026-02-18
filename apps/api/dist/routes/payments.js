"use strict";
// ============================================================
// OrgsLedger API — Payments Routes
// Stripe integration, receipts, refunds
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const config_1 = require("../config");
const logger_1 = require("../logger");
const paystack_service_1 = require("../services/paystack.service");
const flutterwave_service_1 = require("../services/flutterwave.service");
const socket_1 = require("../socket");
const push_service_1 = require("../services/push.service");
const formatters_1 = require("../utils/formatters");
const router = (0, express_1.Router)();
// ── Initialize Stripe ───────────────────────────────────────
let stripe = null;
async function getStripe() {
    if (!stripe && config_1.config.stripe.secretKey) {
        const Stripe = (await Promise.resolve().then(() => __importStar(require('stripe')))).default;
        stripe = new Stripe(config_1.config.stripe.secretKey);
    }
    return stripe;
}
// ── Schemas ─────────────────────────────────────────────────
const payTransactionSchema = zod_1.z.object({
    transactionId: zod_1.z.string().uuid(),
    gateway: zod_1.z.enum(['stripe', 'paystack', 'flutterwave', 'bank_transfer']).default('stripe'),
    paymentMethodId: zod_1.z.string().optional(), // Stripe payment method
    proofOfPayment: zod_1.z.string().optional(), // For bank transfer — reference/receipt
});
const purchaseCreditsSchema = zod_1.z.object({
    credits: zod_1.z.number().int().min(1), // minimum 1 credit (= 1 hour)
});
const refundSchema = zod_1.z.object({
    transactionId: zod_1.z.string().uuid(),
    amount: zod_1.z.number().positive().max(999_999_999).optional(),
    reason: zod_1.z.string().max(500).optional(),
});
const approveTransferSchema = zod_1.z.object({
    transactionId: zod_1.z.string().uuid(),
    approved: zod_1.z.boolean(),
});
// ── Pay a Transaction ───────────────────────────────────────
router.post('/:orgId/payments/pay', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.validate)(payTransactionSchema), async (req, res) => {
    try {
        const { transactionId, gateway, paymentMethodId } = req.body;
        const transaction = await (0, db_1.default)('transactions')
            .where({
            id: transactionId,
            organization_id: req.params.orgId,
            user_id: req.user.userId,
            status: 'pending',
        })
            .first();
        if (!transaction) {
            res.status(404).json({ success: false, error: 'Transaction not found or already processed' });
            return;
        }
        const user = await (0, db_1.default)('users').where({ id: req.user.userId }).select('email', 'first_name', 'last_name').first();
        // ─── STRIPE ─────────────────────────────────────────
        if (gateway === 'stripe') {
            const stripeClient = await getStripe();
            if (stripeClient && paymentMethodId) {
                const paymentIntent = await stripeClient.paymentIntents.create({
                    amount: (0, formatters_1.toSubunits)(transaction.amount),
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
                        userId: req.user.userId,
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
                }
                else {
                    res.status(402).json({
                        success: false,
                        error: 'Payment requires further action',
                        data: { clientSecret: paymentIntent.client_secret },
                    });
                }
            }
            else {
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
            if (!paystack_service_1.paystackService.isConfigured()) {
                await devModeFallback(req, transaction);
                res.json({
                    success: true,
                    data: { transactionId, gateway: 'paystack', status: 'completed', note: 'Dev mode — Paystack not configured' },
                });
                return;
            }
            const reference = `orgsl_${transactionId.replace(/-/g, '').slice(0, 16)}_${Date.now()}`;
            const result = await paystack_service_1.paystackService.initializeTransaction({
                email: user?.email || 'user@orgsledger.com',
                amount: (0, formatters_1.toSubunits)(transaction.amount), // subunit
                currency: transaction.currency,
                reference,
                metadata: {
                    transactionId: transaction.id,
                    organizationId: req.params.orgId,
                    userId: req.user.userId,
                },
            });
            // Store reference for verification
            await (0, db_1.default)('transactions')
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
            if (!flutterwave_service_1.flutterwaveService.isConfigured()) {
                await devModeFallback(req, transaction);
                res.json({
                    success: true,
                    data: { transactionId, gateway: 'flutterwave', status: 'completed', note: 'Dev mode — Flutterwave not configured' },
                });
                return;
            }
            const txRef = `orgsl_${transactionId.replace(/-/g, '').slice(0, 16)}_${Date.now()}`;
            const result = await flutterwave_service_1.flutterwaveService.initializePayment({
                txRef,
                amount: transaction.amount,
                currency: transaction.currency,
                customerEmail: user?.email || 'user@orgsledger.com',
                customerName: `${user?.first_name || ''} ${user?.last_name || ''}`.trim(),
                meta: {
                    transactionId: transaction.id,
                    organizationId: req.params.orgId,
                    userId: req.user.userId,
                },
                description: transaction.description,
            });
            await (0, db_1.default)('transactions')
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
            await (0, db_1.default)('transactions')
                .where({ id: transactionId })
                .update({
                payment_method: 'bank_transfer',
                payment_gateway_id: proofOfPayment || null,
                status: 'awaiting_approval',
            });
            // Notify org admin(s)
            const admins = await (0, db_1.default)('memberships')
                .where({ organization_id: req.params.orgId, role: 'org_admin', is_active: true })
                .pluck('user_id');
            // Batch insert notifications (single query instead of N)
            if (admins.length > 0) {
                const notificationRows = admins.map((adminId) => ({
                    user_id: adminId,
                    organization_id: req.params.orgId,
                    type: 'payment',
                    title: 'Bank Transfer Pending Approval',
                    body: `${user?.first_name || 'A member'} submitted bank transfer of ${transaction.currency} ${transaction.amount}. Proof: ${proofOfPayment || 'Not provided'}`,
                    data: JSON.stringify({ transactionId, type: 'bank_transfer_approval' }),
                }));
                await (0, db_1.default)('notifications').insert(notificationRows);
                // Push notifications are external API calls — fire in parallel
                for (const adminId of admins) {
                    (0, push_service_1.sendPushToUser)(adminId, {
                        title: 'Bank Transfer Pending',
                        body: `${user?.first_name || 'A member'} submitted a bank transfer for ${transaction.currency} ${transaction.amount}. Awaiting your approval.`,
                        data: { transactionId, type: 'bank_transfer_approval' },
                    }).catch(err => logger_1.logger.warn('Push notification failed (bank transfer pending)', err));
                }
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
    }
    catch (err) {
        logger_1.logger.error('Payment error', err);
        res.status(500).json({ success: false, error: 'Payment failed' });
    }
});
// ── Helper: mark transaction completed ──────────────────────
async function markTransactionCompleted(transaction, gatewayId, paymentMethod, gateway) {
    await (0, db_1.default)('transactions')
        .where({ id: transaction.id })
        .update({
        status: 'completed',
        payment_gateway_id: gatewayId,
        payment_method: `${gateway}_${paymentMethod}`,
    });
    if (transaction.reference_type === 'fine') {
        await (0, db_1.default)('fines').where({ id: transaction.reference_id }).update({ status: 'paid' });
    }
    if (transaction.reference_type === 'donation') {
        await (0, db_1.default)('donations').where({ id: transaction.reference_id }).update({ status: 'completed' });
    }
}
async function sendPaymentNotification(req, transaction, gatewayId) {
    await req.audit?.({
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
    await (0, db_1.default)('notifications').insert({
        user_id: req.user.userId,
        organization_id: req.params.orgId,
        type: 'payment',
        title: 'Payment Successful',
        body: `Payment of ${transaction.currency} ${transaction.amount} confirmed.`,
        data: JSON.stringify({ transactionId: transaction.id }),
    });
    // Push notification
    (0, push_service_1.sendPushToUser)(req.user.userId, {
        title: 'Payment Successful',
        body: `Payment of ${transaction.currency} ${transaction.amount} confirmed.`,
        data: { transactionId: transaction.id, type: 'payment' },
    }).catch(err => logger_1.logger.warn('Push notification failed (payment success)', err));
    // Real-time ledger update
    const io = req.app.get('io');
    if (io) {
        (0, socket_1.emitFinancialUpdate)(io, req.params.orgId, {
            type: 'payment_completed',
            transactionId: transaction.id,
            amount: transaction.amount,
            currency: transaction.currency,
            userId: req.user.userId,
        });
    }
}
async function devModeFallback(req, transaction) {
    // CRITICAL: Only allow dev-mode auto-completion in explicit development environment
    if (config_1.config.env !== 'development') {
        throw new Error('Payment gateway not configured. Contact administrator.');
    }
    await (0, db_1.default)('transactions')
        .where({ id: transaction.id })
        .update({
        status: 'completed',
        payment_method: 'dev_mode',
    });
    if (transaction.reference_type === 'fine') {
        await (0, db_1.default)('fines').where({ id: transaction.reference_id }).update({ status: 'paid' });
    }
    if (transaction.reference_type === 'donation') {
        await (0, db_1.default)('donations').where({ id: transaction.reference_id }).update({ status: 'completed' });
    }
    await req.audit?.({
        organizationId: req.params.orgId,
        action: 'payment',
        entityType: 'transaction',
        entityId: transaction.id,
        newValue: { amount: transaction.amount, status: 'completed', mode: 'dev' },
    });
}
// ── Create Stripe Setup Intent ──────────────────────────────
router.post('/:orgId/payments/setup-intent', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const stripeClient = await getStripe();
        if (!stripeClient) {
            res.status(503).json({ success: false, error: 'Stripe not configured' });
            return;
        }
        const setupIntent = await stripeClient.setupIntents.create({
            metadata: {
                userId: req.user.userId,
                organizationId: req.params.orgId,
            },
        });
        res.json({
            success: true,
            data: { clientSecret: setupIntent.client_secret },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to create setup intent' });
    }
});
// ── Request Refund ──────────────────────────────────────────
router.post('/:orgId/payments/refund', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin'), (0, middleware_1.validate)(refundSchema), async (req, res) => {
    try {
        const { transactionId, amount, reason } = req.body;
        const transaction = await (0, db_1.default)('transactions')
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
        if (paymentMethod.includes('bank_transfer') || paymentMethod === 'dev_mode' || paymentMethod === 'manual') {
            // Manual/bank transfer refund — record only, no gateway call
            gatewayRefundId = null;
        }
        else if (paymentMethod.startsWith('stripe') || (!paymentMethod.startsWith('paystack') && !paymentMethod.startsWith('flutterwave'))) {
            // Stripe refund
            const stripeClient = await getStripe();
            if (stripeClient && transaction.payment_gateway_id) {
                const refund = await stripeClient.refunds.create({
                    payment_intent: transaction.payment_gateway_id,
                    amount: (0, formatters_1.toSubunits)(refundAmount),
                });
                gatewayRefundId = refund.id;
            }
        }
        else if (paymentMethod.startsWith('paystack')) {
            // Paystack refund
            if (paystack_service_1.paystackService.isConfigured() && transaction.payment_gateway_id) {
                const result = await paystack_service_1.paystackService.createRefund({
                    transactionReference: transaction.payment_gateway_id,
                    amount: (0, formatters_1.toSubunits)(refundAmount),
                    reason: reason || 'Admin refund',
                });
                gatewayRefundId = result.refundId;
            }
        }
        else if (paymentMethod.startsWith('flutterwave')) {
            // Flutterwave refund
            if (flutterwave_service_1.flutterwaveService.isConfigured() && transaction.payment_gateway_id) {
                const result = await flutterwave_service_1.flutterwaveService.createRefund({
                    transactionId: transaction.payment_gateway_id,
                    amount: refundAmount,
                    reason: reason || 'Admin refund',
                });
                gatewayRefundId = result.refundId;
            }
        }
        // Create refund record
        const [refund] = await (0, db_1.default)('refunds')
            .insert({
            transaction_id: transactionId,
            amount: refundAmount,
            reason: reason || 'Admin refund',
            status: 'completed',
            payment_gateway_refund_id: gatewayRefundId,
            processed_by: req.user.userId,
        })
            .returning('*');
        // Update transaction status
        const newStatus = refundAmount >= transaction.amount ? 'refunded' : 'partially_refunded';
        await (0, db_1.default)('transactions')
            .where({ id: transactionId })
            .update({ status: newStatus });
        // Create refund transaction in ledger
        await (0, db_1.default)('transactions').insert({
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
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'refund',
            entityType: 'transaction',
            entityId: transactionId,
            newValue: { refundAmount, reason, refundId: refund.id },
        });
        // Notify user
        await (0, db_1.default)('notifications').insert({
            user_id: transaction.user_id,
            organization_id: req.params.orgId,
            type: 'payment',
            title: 'Refund Processed',
            body: `A refund of ${transaction.currency} ${refundAmount} has been processed.`,
            data: JSON.stringify({ refundId: refund.id }),
        });
        // Push notification for refund
        (0, push_service_1.sendPushToUser)(transaction.user_id, {
            title: 'Refund Processed',
            body: `A refund of ${transaction.currency} ${refundAmount} has been processed.`,
            data: { refundId: refund.id, type: 'refund' },
        }).catch(err => logger_1.logger.warn('Push notification failed (refund)', err));
        // Real-time ledger update for refund
        const io = req.app.get('io');
        if (io) {
            (0, socket_1.emitFinancialUpdate)(io, req.params.orgId, {
                type: 'refund_completed',
                transactionId,
                refundId: refund.id,
                amount: refundAmount,
                currency: transaction.currency,
                userId: transaction.user_id,
            });
        }
        res.json({ success: true, data: refund });
    }
    catch (err) {
        logger_1.logger.error('Refund error', err);
        res.status(500).json({ success: false, error: 'Failed to process refund' });
    }
});
// ── Stripe Webhook ──────────────────────────────────────────
router.post('/webhooks/stripe', async (req, res) => {
    try {
        const stripeClient = await getStripe();
        if (!stripeClient) {
            res.status(503).send('Stripe not configured');
            return;
        }
        const sig = req.headers['stripe-signature'];
        let event;
        try {
            event = stripeClient.webhooks.constructEvent(req.body, sig, config_1.config.stripe.webhookSecret);
        }
        catch (err) {
            logger_1.logger.error('Webhook signature verification failed', err.message);
            res.status(400).send('Webhook signature verification failed');
            return;
        }
        switch (event.type) {
            case 'payment_intent.succeeded': {
                const paymentIntent = event.data.object;
                const txId = paymentIntent.metadata?.transactionId;
                if (txId) {
                    const tx = await (0, db_1.default)('transactions').where({ id: txId }).first();
                    if (tx && tx.status !== 'completed') {
                        await markTransactionCompleted(tx, paymentIntent.id, 'card', 'stripe');
                        // Send notifications for async confirmations (e.g. 3D Secure)
                        await (0, db_1.default)('notifications').insert({
                            user_id: tx.user_id,
                            organization_id: tx.organization_id,
                            type: 'payment',
                            title: 'Payment Successful',
                            body: `Payment of ${tx.currency} ${tx.amount} confirmed.`,
                            data: JSON.stringify({ transactionId: tx.id }),
                        });
                        (0, push_service_1.sendPushToUser)(tx.user_id, {
                            title: 'Payment Successful',
                            body: `Payment of ${tx.currency} ${tx.amount} confirmed.`,
                            data: { transactionId: tx.id, type: 'payment' },
                        }).catch(err => logger_1.logger.warn('Push notification failed (stripe webhook)', err));
                        const io = req.app.get('io');
                        if (io) {
                            (0, socket_1.emitFinancialUpdate)(io, tx.organization_id, {
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
                    await (0, db_1.default)('transactions')
                        .where({ id: txId })
                        .update({ status: 'failed' });
                }
                break;
            }
        }
        res.json({ received: true });
    }
    catch (err) {
        logger_1.logger.error('Webhook error', err);
        res.status(500).send('Webhook handler failed');
    }
});
// ── Paystack Webhook ────────────────────────────────────────
router.post('/webhooks/paystack', async (req, res) => {
    try {
        const sig = req.headers['x-paystack-signature'];
        const rawBody = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
        if (!paystack_service_1.paystackService.validateWebhook(rawBody, sig)) {
            res.status(400).send('Invalid signature');
            return;
        }
        const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (event.event === 'charge.success') {
            const paymentData = event.data;
            const reference = paymentData.reference;
            const meta = paymentData.metadata;
            if (meta?.transactionId) {
                // Verify payment amount matches expected transaction amount
                const pendingTx = await (0, db_1.default)('transactions').where({ id: meta.transactionId, status: 'pending' }).first();
                if (!pendingTx) {
                    logger_1.logger.warn('[PAYSTACK] Transaction not found or already completed', { transactionId: meta.transactionId, reference });
                    res.json({ received: true });
                    return;
                }
                const paidAmount = paymentData.amount; // Paystack sends amount in subunits (kobo/cents)
                const expectedAmount = Math.round(pendingTx.amount * 100); // Convert stored amount to subunits
                if (paidAmount < expectedAmount) {
                    logger_1.logger.error('[PAYSTACK] Amount mismatch — possible underpayment attack', { transactionId: meta.transactionId, paid: paidAmount, expected: expectedAmount, reference });
                    await (0, db_1.default)('transactions').where({ id: meta.transactionId }).update({ status: 'failed', notes: `Amount mismatch: paid ${paidAmount}, expected ${expectedAmount}` });
                    res.json({ received: true });
                    return;
                }
                await (0, db_1.default)('transactions')
                    .where({ id: meta.transactionId, status: 'pending' })
                    .update({
                    status: 'completed',
                    payment_gateway_id: reference,
                    payment_method: `paystack_${paymentData.channel || 'card'}`,
                });
                // Update related records
                const tx = await (0, db_1.default)('transactions').where({ id: meta.transactionId }).first();
                if (tx?.reference_type === 'fine') {
                    await (0, db_1.default)('fines').where({ id: tx.reference_id }).update({ status: 'paid' });
                }
                if (tx?.reference_type === 'donation') {
                    await (0, db_1.default)('donations').where({ id: tx.reference_id }).update({ status: 'completed' });
                }
                await (0, db_1.default)('notifications').insert({
                    user_id: meta.userId,
                    organization_id: meta.organizationId,
                    type: 'payment',
                    title: 'Payment Successful',
                    body: `Your Paystack payment has been confirmed.`,
                    data: JSON.stringify({ transactionId: meta.transactionId }),
                });
                // Push notification for Paystack payment
                (0, push_service_1.sendPushToUser)(meta.userId, {
                    title: 'Payment Successful',
                    body: 'Your Paystack payment has been confirmed.',
                    data: { transactionId: meta.transactionId, type: 'payment' },
                }).catch(err => logger_1.logger.warn('Push notification failed (paystack webhook)', err));
                // Real-time ledger update
                const io = req.app.get('io');
                if (io && meta.organizationId) {
                    (0, socket_1.emitFinancialUpdate)(io, meta.organizationId, {
                        type: 'payment_completed',
                        transactionId: meta.transactionId,
                        userId: meta.userId,
                    });
                }
            }
        }
        res.json({ received: true });
    }
    catch (err) {
        logger_1.logger.error('Paystack webhook error', err);
        res.status(500).send('Webhook handler failed');
    }
});
// ── Paystack callback (redirect after payment) ─────────────
router.get('/paystack/callback', async (req, res) => {
    try {
        const reference = req.query.reference;
        if (!reference) {
            res.status(400).send('Missing reference');
            return;
        }
        const result = await paystack_service_1.paystackService.verifyTransaction(reference);
        if (result.status === 'success') {
            // Find transaction by gateway_id
            const tx = await (0, db_1.default)('transactions')
                .where({ payment_gateway_id: reference })
                .first();
            if (tx && tx.status === 'pending') {
                // Verify amount matches (Paystack returns amount in subunits)
                const paidAmount = result.amount || 0;
                const expectedAmount = Math.round(tx.amount * 100);
                if (paidAmount < expectedAmount) {
                    logger_1.logger.error('[PAYSTACK-CB] Amount mismatch', { txId: tx.id, paid: paidAmount, expected: expectedAmount, reference });
                    res.redirect(`orgsledger://payment-complete?reference=${encodeURIComponent(reference)}&status=amount_mismatch`);
                    return;
                }
                await (0, db_1.default)('transactions')
                    .where({ id: tx.id })
                    .update({
                    status: 'completed',
                    payment_method: `paystack_${result.channel}`,
                });
                if (tx.reference_type === 'fine') {
                    await (0, db_1.default)('fines').where({ id: tx.reference_id }).update({ status: 'paid' });
                }
                if (tx.reference_type === 'donation') {
                    await (0, db_1.default)('donations').where({ id: tx.reference_id }).update({ status: 'completed' });
                }
            }
        }
        // Redirect to mobile deep link
        res.redirect(`orgsledger://payment-complete?reference=${encodeURIComponent(reference)}&status=${result.status}`);
    }
    catch (err) {
        logger_1.logger.error('Paystack callback error', err);
        res.redirect('orgsledger://payment-complete?status=error');
    }
});
// ── Flutterwave Webhook ─────────────────────────────────────
router.post('/webhooks/flutterwave', async (req, res) => {
    try {
        const secretHash = req.headers['verif-hash'];
        if (!flutterwave_service_1.flutterwaveService.validateWebhook(secretHash)) {
            res.status(401).send('Invalid hash');
            return;
        }
        const payload = req.body;
        if (payload.event === 'charge.completed' && payload.data?.status === 'successful') {
            const txRef = payload.data.tx_ref;
            const meta = payload.data.meta;
            const tx = await (0, db_1.default)('transactions')
                .where({ payment_gateway_id: txRef })
                .first();
            if (tx && tx.status === 'pending') {
                // Verify amount matches (Flutterwave returns amount in major units)
                const paidAmount = parseFloat(payload.data.amount) || 0;
                const expectedAmount = parseFloat(tx.amount) || 0;
                if (paidAmount < expectedAmount) {
                    logger_1.logger.error('[FLUTTERWAVE] Amount mismatch — possible underpayment attack', { txId: tx.id, paid: paidAmount, expected: expectedAmount, txRef });
                    await (0, db_1.default)('transactions').where({ id: tx.id }).update({ status: 'failed', notes: `Amount mismatch: paid ${paidAmount}, expected ${expectedAmount}` });
                    res.status(200).send('ok');
                    return;
                }
                await (0, db_1.default)('transactions')
                    .where({ id: tx.id })
                    .update({
                    status: 'completed',
                    payment_method: `flutterwave_${payload.data.payment_type || 'card'}`,
                });
                if (tx.reference_type === 'fine') {
                    await (0, db_1.default)('fines').where({ id: tx.reference_id }).update({ status: 'paid' });
                }
                if (tx.reference_type === 'donation') {
                    await (0, db_1.default)('donations').where({ id: tx.reference_id }).update({ status: 'completed' });
                }
                await (0, db_1.default)('notifications').insert({
                    user_id: tx.user_id,
                    organization_id: tx.organization_id,
                    type: 'payment',
                    title: 'Payment Successful',
                    body: `Your Flutterwave payment has been confirmed.`,
                    data: JSON.stringify({ transactionId: tx.id }),
                });
                // Push notification for Flutterwave payment
                (0, push_service_1.sendPushToUser)(tx.user_id, {
                    title: 'Payment Successful',
                    body: 'Your Flutterwave payment has been confirmed.',
                    data: { transactionId: tx.id, type: 'payment' },
                }).catch(err => logger_1.logger.warn('Push notification failed (flutterwave webhook)', err));
                // Real-time ledger update
                const io = req.app.get('io');
                if (io) {
                    (0, socket_1.emitFinancialUpdate)(io, tx.organization_id, {
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
    }
    catch (err) {
        logger_1.logger.error('Flutterwave webhook error', err);
        res.status(500).send('Webhook handler failed');
    }
});
// ── Flutterwave callback (redirect after payment) ──────────
router.get('/flutterwave/callback', async (req, res) => {
    try {
        const txRef = req.query.tx_ref;
        const flwTransactionId = req.query.transaction_id;
        if (!flwTransactionId || !txRef) {
            res.redirect('orgsledger://payment-complete?status=error');
            return;
        }
        const result = await flutterwave_service_1.flutterwaveService.verifyTransaction(flwTransactionId);
        if (result.status === 'successful') {
            const tx = await (0, db_1.default)('transactions')
                .where({ payment_gateway_id: txRef })
                .first();
            if (tx && tx.status === 'pending') {
                // Verify amount matches
                const paidAmount = parseFloat(String(result.amount)) || 0;
                const expectedAmount = parseFloat(tx.amount) || 0;
                if (paidAmount < expectedAmount) {
                    logger_1.logger.error('[FLUTTERWAVE-CB] Amount mismatch', { txId: tx.id, paid: paidAmount, expected: expectedAmount, txRef });
                    res.redirect(`orgsledger://payment-complete?tx_ref=${encodeURIComponent(txRef)}&status=amount_mismatch`);
                    return;
                }
                await (0, db_1.default)('transactions')
                    .where({ id: tx.id })
                    .update({
                    status: 'completed',
                    payment_method: `flutterwave_${result.paymentType}`,
                });
                if (tx.reference_type === 'fine') {
                    await (0, db_1.default)('fines').where({ id: tx.reference_id }).update({ status: 'paid' });
                }
                if (tx.reference_type === 'donation') {
                    await (0, db_1.default)('donations').where({ id: tx.reference_id }).update({ status: 'completed' });
                }
            }
        }
        res.redirect(`orgsledger://payment-complete?tx_ref=${encodeURIComponent(txRef)}&status=${result.status}`);
    }
    catch (err) {
        logger_1.logger.error('Flutterwave callback error', err);
        res.redirect('orgsledger://payment-complete?status=error');
    }
});
// ── Available Gateways (org-configurable + bank_transfer) ───
router.get('/:orgId/payments/gateways', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    let orgMethods = null;
    try {
        const org = await (0, db_1.default)('organizations').where({ id: req.params.orgId }).select('settings').first();
        const settings = org?.settings
            ? (typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings)
            : {};
        orgMethods = settings.payment_methods;
    }
    catch (err) {
        logger_1.logger.warn('Failed to parse org payment settings', err);
    }
    const gateways = [];
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
    }
    else {
        if (config_1.config.paystack.secretKey)
            gateways.push({ id: 'paystack', name: 'Paystack', type: 'redirect' });
        if (config_1.config.flutterwave.secretKey)
            gateways.push({ id: 'flutterwave', name: 'Flutterwave', type: 'redirect' });
        if (config_1.config.stripe.secretKey)
            gateways.push({ id: 'stripe', name: 'Stripe', type: 'card' });
    }
    if (!gateways.length) {
        gateways.push({ id: 'stripe', name: 'Dev Mode', type: 'dev' });
    }
    res.json({ success: true, data: gateways });
});
// ── Verify Payment (for mobile to check status after redirect) ──
router.get('/:orgId/payments/verify/:transactionId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const transaction = await (0, db_1.default)('transactions')
            .where({
            id: req.params.transactionId,
            organization_id: req.params.orgId,
            user_id: req.user.userId,
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to verify payment' });
    }
});
// ══════════════════════════════════════════════════════════════
// AI CREDITS
// ══════════════════════════════════════════════════════════════
router.get('/:orgId/ai-credits', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const wallet = await (0, db_1.default)('ai_wallet')
            .where({ organization_id: req.params.orgId })
            .first();
        const history = await (0, db_1.default)('ai_wallet_transactions')
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get AI credits' });
    }
});
router.post('/:orgId/ai-credits/purchase', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin'), (0, middleware_1.validate)(purchaseCreditsSchema), async (req, res) => {
    try {
        const { credits: creditsToPurchase } = req.body;
        const wallet = await (0, db_1.default)('ai_wallet')
            .where({ organization_id: req.params.orgId })
            .first();
        const pricePerHour = parseFloat(wallet?.price_per_hour_usd) || 10.00;
        const totalPrice = creditsToPurchase * pricePerHour;
        // Create payment transaction
        const [transaction] = await (0, db_1.default)('transactions')
            .insert({
            organization_id: req.params.orgId,
            user_id: req.user.userId,
            type: 'ai_credit_purchase',
            amount: totalPrice,
            currency: 'USD',
            status: 'pending',
            description: `AI Credits: ${creditsToPurchase} credit${creditsToPurchase > 1 ? 's' : ''} (${creditsToPurchase} hour${creditsToPurchase > 1 ? 's' : ''})`,
        })
            .returning('*');
        // In dev mode only, auto-complete (NEVER in production)
        if (!config_1.config.stripe.secretKey && config_1.config.env === 'development') {
            await (0, db_1.default)('transactions')
                .where({ id: transaction.id })
                .update({ status: 'completed' });
            // Add minutes to AI wallet
            await (0, db_1.default)('ai_wallet')
                .where({ organization_id: req.params.orgId })
                .update({
                balance_minutes: db_1.default.raw('balance_minutes + ?', [creditsToPurchase * 60]),
            });
            await (0, db_1.default)('ai_wallet_transactions').insert({
                organization_id: req.params.orgId,
                type: 'topup',
                amount_minutes: creditsToPurchase * 60,
                cost: totalPrice,
                currency: 'USD',
                description: `Purchased ${creditsToPurchase} hour${creditsToPurchase > 1 ? 's' : ''} of AI credits`,
            });
            await req.audit?.({
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to purchase credits' });
    }
});
// ══════════════════════════════════════════════════════════════
// BANK TRANSFER — ADMIN APPROVAL
// ══════════════════════════════════════════════════════════════
// List pending bank transfers
router.get('/:orgId/payments/pending-transfers', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin'), async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;
        const transfers = await (0, db_1.default)('transactions')
            .leftJoin('users', 'transactions.user_id', 'users.id')
            .where({
            'transactions.organization_id': req.params.orgId,
            'transactions.payment_method': 'bank_transfer',
            'transactions.status': 'awaiting_approval',
        })
            .select('transactions.*', 'users.first_name', 'users.last_name', 'users.email')
            .orderBy('transactions.created_at', 'desc')
            .limit(limit)
            .offset(offset);
        res.json({ success: true, data: transfers, meta: { page, limit } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to load pending transfers' });
    }
});
// Approve or reject bank transfer
router.post('/:orgId/payments/approve-transfer', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin'), (0, middleware_1.validate)(approveTransferSchema), async (req, res) => {
    try {
        const { transactionId, approved } = req.body;
        const transaction = await (0, db_1.default)('transactions')
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
            await markTransactionCompleted(transaction, transaction.payment_gateway_id || 'bank_transfer_approved', 'bank_transfer', 'bank');
            await (0, db_1.default)('notifications').insert({
                user_id: transaction.user_id,
                organization_id: req.params.orgId,
                type: 'payment',
                title: 'Payment Approved',
                body: `Your bank transfer of ${transaction.currency} ${transaction.amount} has been approved.`,
                data: JSON.stringify({ transactionId }),
            });
            (0, push_service_1.sendPushToUser)(transaction.user_id, {
                title: 'Payment Approved',
                body: `Your bank transfer of ${transaction.currency} ${transaction.amount} has been approved.`,
                data: { transactionId, type: 'payment' },
            }).catch(err => logger_1.logger.warn('Push notification failed (transfer approved)', err));
            const io = req.app.get('io');
            if (io) {
                (0, socket_1.emitFinancialUpdate)(io, req.params.orgId, {
                    type: 'payment_completed',
                    transactionId,
                    amount: transaction.amount,
                    currency: transaction.currency,
                    userId: transaction.user_id,
                });
            }
        }
        else {
            await (0, db_1.default)('transactions')
                .where({ id: transactionId })
                .update({ status: 'failed', payment_method: 'bank_transfer_rejected' });
            await (0, db_1.default)('notifications').insert({
                user_id: transaction.user_id,
                organization_id: req.params.orgId,
                type: 'payment',
                title: 'Payment Rejected',
                body: `Your bank transfer of ${transaction.currency} ${transaction.amount} was not approved. Please contact admin.`,
                data: JSON.stringify({ transactionId }),
            });
            (0, push_service_1.sendPushToUser)(transaction.user_id, {
                title: 'Payment Rejected',
                body: `Your bank transfer of ${transaction.currency} ${transaction.amount} was not approved.`,
                data: { transactionId, type: 'payment' },
            }).catch(err => logger_1.logger.warn('Push notification failed (transfer rejected)', err));
        }
        await req.audit?.({
            organizationId: req.params.orgId,
            action: approved ? 'approve' : 'reject',
            entityType: 'bank_transfer',
            entityId: transactionId,
            newValue: { approved, amount: transaction.amount },
        });
        res.json({ success: true, message: approved ? 'Transfer approved' : 'Transfer rejected' });
    }
    catch (err) {
        logger_1.logger.error('Approve transfer error', err);
        res.status(500).json({ success: false, error: 'Failed to process approval' });
    }
});
// ══════════════════════════════════════════════════════════════
// PAYMENT METHOD CONFIGURATION (ORG ADMIN)
// ══════════════════════════════════════════════════════════════
// Get org payment methods config
router.get('/:orgId/payments/methods', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const org = await (0, db_1.default)('organizations')
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get payment methods' });
    }
});
// Update org payment methods config (admin only)
const paymentMethodsSchema = zod_1.z.object({
    paymentMethods: zod_1.z.object({
        stripe: zod_1.z.object({ enabled: zod_1.z.boolean() }).passthrough().optional(),
        paystack: zod_1.z.object({ enabled: zod_1.z.boolean() }).passthrough().optional(),
        flutterwave: zod_1.z.object({ enabled: zod_1.z.boolean() }).passthrough().optional(),
        bank_transfer: zod_1.z.object({
            enabled: zod_1.z.boolean(),
            bank_name: zod_1.z.string().max(200).optional(),
            account_number: zod_1.z.string().max(50).optional(),
            account_name: zod_1.z.string().max(200).optional(),
            sort_code: zod_1.z.string().max(20).optional(),
            instructions: zod_1.z.string().max(500).optional(),
        }).optional(),
    }),
});
router.put('/:orgId/payments/methods', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin'), async (req, res) => {
    try {
        const parsed = paymentMethodsSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ success: false, error: 'Invalid payment methods configuration', details: parsed.error.flatten() });
            return;
        }
        const { paymentMethods } = parsed.data;
        const org = await (0, db_1.default)('organizations')
            .where({ id: req.params.orgId })
            .select('settings')
            .first();
        const settings = org?.settings
            ? (typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings)
            : {};
        settings.payment_methods = paymentMethods;
        await (0, db_1.default)('organizations')
            .where({ id: req.params.orgId })
            .update({ settings: JSON.stringify(settings) });
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'update',
            entityType: 'payment_methods',
            entityId: req.params.orgId,
            newValue: paymentMethods,
        });
        res.json({ success: true, message: 'Payment methods updated' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update payment methods' });
    }
});
exports.default = router;
//# sourceMappingURL=payments.js.map