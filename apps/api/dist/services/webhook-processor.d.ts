import { Request, Response } from 'express';
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
export declare abstract class WebhookProcessor {
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
    process(req: Request, res: Response): Promise<void>;
    private markCompleted;
    private updateRelatedRecords;
    private sendNotifications;
}
//# sourceMappingURL=webhook-processor.d.ts.map