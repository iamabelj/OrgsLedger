import { AxiosInstance } from 'axios';
declare class PaystackService {
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
     * Initialize a transaction — returns an authorization URL
     * for the user to complete payment in a WebView/browser.
     */
    initializeTransaction(params: {
        email: string;
        amount: number;
        currency: string;
        reference: string;
        callbackUrl?: string;
        metadata?: Record<string, any>;
        orgSecretKey?: string;
    }): Promise<{
        authorizationUrl: string;
        accessCode: string;
        reference: string;
    }>;
    /**
     * Verify a transaction by reference.
     */
    verifyTransaction(reference: string, orgSecretKey?: string): Promise<{
        status: string;
        reference: string;
        amount: number;
        currency: string;
        gatewayResponse: string;
        paidAt: string | null;
        channel: string;
        metadata: any;
    }>;
    /**
     * Initiate a refund.
     */
    createRefund(params: {
        transactionReference: string;
        amount?: number;
        reason?: string;
        orgSecretKey?: string;
    }): Promise<{
        refundId: any;
        status: any;
        amount: any;
    }>;
    /**
     * Validate a Paystack webhook signature.
     * Supports per-org secret keys for multi-tenant webhook verification.
     */
    validateWebhook(body: string | Buffer, signature: string, orgSecretKey?: string): boolean;
}
export declare const paystackService: PaystackService;
export {};
//# sourceMappingURL=paystack.service.d.ts.map