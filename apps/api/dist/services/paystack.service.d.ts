declare class PaystackService {
    private client;
    private getClient;
    isConfigured(): boolean;
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
    }): Promise<{
        authorizationUrl: string;
        accessCode: string;
        reference: string;
    }>;
    /**
     * Verify a transaction by reference.
     */
    verifyTransaction(reference: string): Promise<{
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
    }): Promise<{
        refundId: any;
        status: any;
        amount: any;
    }>;
    /**
     * Validate a Paystack webhook signature.
     */
    validateWebhook(body: string | Buffer, signature: string): boolean;
}
export declare const paystackService: PaystackService;
export {};
//# sourceMappingURL=paystack.service.d.ts.map