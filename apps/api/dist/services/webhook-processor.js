"use strict";
// ============================================================
// OrgsLedger API — Abstract Webhook Processor
// Eliminates duplicated verification → lookup → complete → notify
// logic across Stripe, Paystack, Flutterwave webhooks.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookProcessor = void 0;
const db_1 = __importDefault(require("../db"));
const logger_1 = require("../logger");
const registry_1 = require("../services/registry");
const socket_1 = require("../socket");
const push_service_1 = require("../services/push.service");
const constants_1 = require("../constants");
/**
 * Abstract base class for payment webhook processors.
 *
 * Subclasses only need to implement:
 *   - verifySignature()  — gateway-specific signature check
 *   - extractPaymentData() — extract transaction info from the payload
 *
 * The template method `process()` handles the rest:
 *   1. Verify signature
 *   2. Extract payment data
 *   3. Mark transaction completed
 *   4. Update related records (fines, donations)
 *   5. Send notification + push + socket event
 */
class WebhookProcessor {
    /** Template method — call from the route handler */
    async process(req, res) {
        try {
            // 1. Signature verification
            if (!this.verifySignature(req)) {
                res.status(400).send('Invalid signature');
                return;
            }
            // 2. Extract data
            const data = this.extractPaymentData(req);
            if (!data || !data.transactionId) {
                // Event type we don't care about — acknowledge silently
                res.json({ received: true });
                return;
            }
            // 3. Complete the transaction
            const tx = await (0, db_1.default)('transactions').where({ id: data.transactionId }).first();
            if (!tx || tx.status !== constants_1.TX_STATUS.PENDING) {
                // Already processed or not found — still acknowledge
                res.json({ received: true });
                return;
            }
            await this.markCompleted(tx, data);
            // 4. Update related records
            await this.updateRelatedRecords(tx);
            // 5. Notifications
            await this.sendNotifications(tx, data);
            res.json({ received: true });
        }
        catch (err) {
            logger_1.logger.error(`${this.gatewayName} webhook error`, err);
            res.status(500).send('Webhook handler failed');
        }
    }
    // ── Shared helpers ────────────────────────────────────────
    async markCompleted(tx, data) {
        await (0, db_1.default)('transactions')
            .where({ id: tx.id })
            .update({
            status: constants_1.TX_STATUS.COMPLETED,
            payment_gateway_id: data.gatewayReference || null,
            payment_method: data.paymentMethod
                ? `${this.gatewayName}_${data.paymentMethod}`
                : this.gatewayName,
        });
    }
    async updateRelatedRecords(tx) {
        if (tx.reference_type === 'fine') {
            await (0, db_1.default)('fines').where({ id: tx.reference_id }).update({ status: 'paid' });
        }
        if (tx.reference_type === 'donation') {
            await (0, db_1.default)('donations').where({ id: tx.reference_id }).update({ status: constants_1.TX_STATUS.COMPLETED });
        }
    }
    async sendNotifications(tx, data) {
        const userId = data.userId || tx.user_id;
        const orgId = data.organizationId || tx.organization_id;
        // In-app notification
        if (userId) {
            await (0, db_1.default)('notifications').insert({
                user_id: userId,
                organization_id: orgId,
                type: constants_1.NOTIFICATION_TYPES.PAYMENT,
                title: 'Payment Successful',
                body: `Your ${this.gatewayName} payment has been confirmed.`,
                data: JSON.stringify({ transactionId: tx.id }),
            });
            (0, push_service_1.sendPushToUser)(userId, {
                title: 'Payment Successful',
                body: `Your ${this.gatewayName} payment has been confirmed.`,
                data: { transactionId: tx.id, type: constants_1.NOTIFICATION_TYPES.PAYMENT },
            }).catch(() => { });
        }
        // Real-time socket event
        const io = registry_1.services.getOptional('io');
        if (io && orgId) {
            (0, socket_1.emitFinancialUpdate)(io, orgId, {
                type: 'payment_completed',
                transactionId: tx.id,
                amount: tx.amount,
                currency: tx.currency,
                userId,
            });
        }
    }
}
exports.WebhookProcessor = WebhookProcessor;
//# sourceMappingURL=webhook-processor.js.map