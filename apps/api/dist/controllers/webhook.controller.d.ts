import { Request, Response } from 'express';
import { WebhookProcessor, WebhookResult } from '../services/webhook-processor';
declare class StripeWebhookProcessor extends WebhookProcessor {
    protected readonly gatewayName = "stripe";
    protected verifySignature(_req: Request): boolean;
    protected extractPaymentData(req: Request): WebhookResult | null;
    /** Override process to handle Stripe-specific construction */
    process(req: Request, res: Response): Promise<void>;
}
declare class PaystackWebhookProcessor extends WebhookProcessor {
    protected readonly gatewayName = "paystack";
    protected verifySignature(req: Request): boolean;
    protected extractPaymentData(req: Request): WebhookResult | null;
}
declare class FlutterwaveWebhookProcessor extends WebhookProcessor {
    protected readonly gatewayName = "flutterwave";
    protected verifySignature(req: Request): boolean;
    protected extractPaymentData(req: Request): WebhookResult | null;
    /** Override — Flutterwave looks up tx by gateway_id (tx_ref) not metadata */
    process(req: Request, res: Response): Promise<void>;
}
export declare const stripeWebhook: StripeWebhookProcessor;
export declare const paystackWebhook: PaystackWebhookProcessor;
export declare const flutterwaveWebhook: FlutterwaveWebhookProcessor;
/** Convenience namespace for route wiring */
export declare class WebhookController {
    static stripe: StripeWebhookProcessor;
    static paystack: PaystackWebhookProcessor;
    static flutterwave: FlutterwaveWebhookProcessor;
}
export declare const webhookController: WebhookController;
export {};
//# sourceMappingURL=webhook.controller.d.ts.map