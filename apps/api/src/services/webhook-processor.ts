// ============================================================
// OrgsLedger API — Abstract Webhook Processor
// Eliminates duplicated verification → lookup → complete → notify
// logic across Stripe, Paystack, Flutterwave webhooks.
// ============================================================

import { Request, Response } from 'express';
import db from '../db';
import { logger } from '../logger';
import { services } from '../services/registry';
import { emitFinancialUpdate } from '../socket';
import { sendPushToUser } from '../services/push.service';
import { NOTIFICATION_TYPES, TX_STATUS } from '../constants';

export interface WebhookResult {
  transactionId?: string;
  userId?: string;
  organizationId?: string;
  paymentMethod?: string;
  gatewayReference?: string;
  channel?: string;
}

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
export abstract class WebhookProcessor {
  protected abstract readonly gatewayName: string;

  /** Verify the webhook signature / hash. Return false to reject. */
  protected abstract verifySignature(req: Request): boolean;

  /**
   * Parse the gateway-specific payload and return info needed to complete
   * the transaction.  Return `null` if the event should be ignored
   * (e.g. events other than successful charges).
   */
  protected abstract extractPaymentData(req: Request): WebhookResult | null;

  /** Template method — call from the route handler */
  async process(req: Request, res: Response): Promise<void> {
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
      const tx = await db('transactions').where({ id: data.transactionId }).first();
      if (!tx || tx.status !== TX_STATUS.PENDING) {
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
    } catch (err) {
      logger.error(`${this.gatewayName} webhook error`, err);
      res.status(500).send('Webhook handler failed');
    }
  }

  // ── Shared helpers ────────────────────────────────────────

  private async markCompleted(tx: any, data: WebhookResult): Promise<void> {
    await db('transactions')
      .where({ id: tx.id })
      .update({
        status: TX_STATUS.COMPLETED,
        payment_gateway_id: data.gatewayReference || null,
        payment_method: data.paymentMethod
          ? `${this.gatewayName}_${data.paymentMethod}`
          : this.gatewayName,
      });
  }

  private async updateRelatedRecords(tx: any): Promise<void> {
    if (tx.reference_type === 'fine') {
      await db('fines').where({ id: tx.reference_id }).update({ status: 'paid' });
    }
    if (tx.reference_type === 'donation') {
      await db('donations').where({ id: tx.reference_id }).update({ status: TX_STATUS.COMPLETED });
    }
  }

  private async sendNotifications(tx: any, data: WebhookResult): Promise<void> {
    const userId = data.userId || tx.user_id;
    const orgId = data.organizationId || tx.organization_id;

    // In-app notification
    if (userId) {
      await db('notifications').insert({
        user_id: userId,
        organization_id: orgId,
        type: NOTIFICATION_TYPES.PAYMENT,
        title: 'Payment Successful',
        body: `Your ${this.gatewayName} payment has been confirmed.`,
        data: JSON.stringify({ transactionId: tx.id }),
      });

      sendPushToUser(userId, {
        title: 'Payment Successful',
        body: `Your ${this.gatewayName} payment has been confirmed.`,
        data: { transactionId: tx.id, type: NOTIFICATION_TYPES.PAYMENT },
      }).catch(() => {});
    }

    // Real-time socket event
    const io = services.getOptional('io');
    if (io && orgId) {
      emitFinancialUpdate(io, orgId, {
        type: 'payment_completed',
        transactionId: tx.id,
        amount: tx.amount,
        currency: tx.currency,
        userId,
      });
    }
  }
}
