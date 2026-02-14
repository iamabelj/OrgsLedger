declare class FlutterwaveService {
    private client;
    private getClient;
    isConfigured(): boolean;
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
    }): Promise<{
        paymentLink: string;
        txRef: string;
    }>;
    /**
     * Verify a transaction by its Flutterwave transaction ID.
     */
    verifyTransaction(transactionId: string | number): Promise<{
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
    }): Promise<{
        refundId: any;
        status: any;
        amountRefunded: any;
    }>;
    /**
     * Validate a Flutterwave webhook request.
     * Checks the verif-hash header using timing-safe comparison against the configured webhook hash.
     */
    validateWebhook(secretHash: string): boolean;
}
export declare const flutterwaveService: FlutterwaveService;
export {};
//# sourceMappingURL=flutterwave.service.d.ts.map