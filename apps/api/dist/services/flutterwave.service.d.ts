import { AxiosInstance } from 'axios';
declare class FlutterwaveService {
    /** Global singleton client (env-var keys) */
    private globalClient;
    /** Build an authenticated Axios client for a given secret key. */
    private buildClient;
    /**
     * Get an Axios client.
     * If an org-level secret key is provided it takes priority;
     * otherwise falls back to the platform-level env-var key.
     */
    getClient(orgSecretKey?: string): AxiosInstance | null;
    isConfigured(orgSecretKey?: string): boolean;
    /**
     * Initialize a standard payment — returns a hosted payment link.
     */
    initializePayment(params: {
        txRef: string;
        amount: number;
        currency: string;
        customerEmail: string;
        customerName?: string;
        redirectUrl?: string;
        meta?: Record<string, any>;
        title?: string;
        description?: string;
        orgSecretKey?: string;
    }): Promise<{
        paymentLink: string;
        txRef: string;
    }>;
    /**
     * Verify a transaction by its Flutterwave transaction ID.
     */
    verifyTransaction(transactionId: string | number, orgSecretKey?: string): Promise<{
        status: string;
        txRef: string;
        flwRef: string;
        amount: number;
        currency: string;
        chargedAmount: number;
        paymentType: string;
        customerEmail: any;
        meta: any;
    }>;
    /**
     * Initiate a refund.
     */
    createRefund(params: {
        transactionId: number | string;
        amount?: number;
        reason?: string;
        orgSecretKey?: string;
    }): Promise<{
        refundId: any;
        status: any;
        amountRefunded: any;
    }>;
    /**
     * Validate a Flutterwave webhook request.
     * Supports per-org webhook hash for multi-tenant verification.
     */
    validateWebhook(secretHash: string, orgWebhookHash?: string): boolean;
}
export declare const flutterwaveService: FlutterwaveService;
export {};
//# sourceMappingURL=flutterwave.service.d.ts.map