"use strict";
// ============================================================
// OrgsLedger API — Webhook Controller
// Concrete webhook processors for Stripe, Paystack, Flutterwave.
// Extends the abstract WebhookProcessor to eliminate duplicated logic.
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
exports.webhookController = exports.WebhookController = exports.flutterwaveWebhook = exports.paystackWebhook = exports.stripeWebhook = void 0;
const webhook_processor_1 = require("../services/webhook-processor");
const config_1 = require("../config");
const paystack_service_1 = require("../services/paystack.service");
const flutterwave_service_1 = require("../services/flutterwave.service");
const logger_1 = require("../logger");
const db_1 = __importDefault(require("../db"));
const constants_1 = require("../constants");
// Cache Stripe instance
let stripe = null;
async function getStripe() {
    if (!stripe && config_1.config.stripe.secretKey) {
        const Stripe = (await Promise.resolve().then(() => __importStar(require('stripe')))).default;
        stripe = new Stripe(config_1.config.stripe.secretKey, { apiVersion: '2024-04-10' });
    }
    return stripe;
}
// ── Stripe ──────────────────────────────────────────────────
class StripeWebhookProcessor extends webhook_processor_1.WebhookProcessor {
    gatewayName = 'stripe';
    verifySignature(_req) {
        // Stripe signature is verified during event construction in extractPaymentData
        return true;
    }
    extractPaymentData(req) {
        // Stripe event construction happens here because it's tightly
        // coupled with signature verification (constructEvent does both).
        const event = req.__stripeEvent;
        if (!event)
            return null;
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
    async process(req, res) {
        try {
            const stripeClient = await getStripe();
            if (!stripeClient) {
                res.status(503).send('Stripe not configured');
                return;
            }
            const sig = req.headers['stripe-signature'];
            try {
                req.__stripeEvent = stripeClient.webhooks.constructEvent(req.body, sig, config_1.config.stripe.webhookSecret);
            }
            catch (err) {
                logger_1.logger.error('Stripe signature verification failed', err.message);
                res.status(400).send(`Webhook Error: ${err.message}`);
                return;
            }
            const event = req.__stripeEvent;
            // Handle failed payments separately
            if (event.type === 'payment_intent.payment_failed') {
                const pi = event.data.object;
                const txId = pi.metadata?.transactionId;
                if (txId) {
                    await (0, db_1.default)('transactions')
                        .where({ id: txId })
                        .update({ status: constants_1.TX_STATUS.FAILED });
                }
                res.json({ received: true });
                return;
            }
            // Delegate to base class for success path
            await super.process(req, res);
        }
        catch (err) {
            logger_1.logger.error('Stripe webhook error', err);
            res.status(500).send('Webhook handler failed');
        }
    }
}
// ── Paystack ────────────────────────────────────────────────
class PaystackWebhookProcessor extends webhook_processor_1.WebhookProcessor {
    gatewayName = 'paystack';
    verifySignature(req) {
        const sig = req.headers['x-paystack-signature'];
        const rawBody = typeof req.body === 'string'
            ? req.body
            : Buffer.isBuffer(req.body)
                ? req.body.toString('utf8')
                : JSON.stringify(req.body);
        return paystack_service_1.paystackService.validateWebhook(rawBody, sig);
    }
    extractPaymentData(req) {
        const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (event.event !== 'charge.success')
            return null;
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
class FlutterwaveWebhookProcessor extends webhook_processor_1.WebhookProcessor {
    gatewayName = 'flutterwave';
    verifySignature(req) {
        const secretHash = req.headers['verif-hash'];
        return flutterwave_service_1.flutterwaveService.validateWebhook(secretHash);
    }
    extractPaymentData(req) {
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
    async process(req, res) {
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
            const tx = await (0, db_1.default)('transactions')
                .where({ payment_gateway_id: result.gatewayReference })
                .first();
            if (!tx || tx.status !== constants_1.TX_STATUS.PENDING) {
                res.status(200).send('ok');
                return;
            }
            // Re-use base class logic by injecting tx id
            req.__txOverride = tx;
            result.transactionId = tx.id;
            // Now delegate to base
            await super.process(req, res);
        }
        catch (err) {
            logger_1.logger.error('Flutterwave webhook error', err);
            res.status(500).send('Webhook handler failed');
        }
    }
}
// ── Exported singletons ─────────────────────────────────────
exports.stripeWebhook = new StripeWebhookProcessor();
exports.paystackWebhook = new PaystackWebhookProcessor();
exports.flutterwaveWebhook = new FlutterwaveWebhookProcessor();
/** Convenience namespace for route wiring */
class WebhookController {
    static stripe = exports.stripeWebhook;
    static paystack = exports.paystackWebhook;
    static flutterwave = exports.flutterwaveWebhook;
}
exports.WebhookController = WebhookController;
exports.webhookController = new WebhookController();
//# sourceMappingURL=webhook.controller.js.map