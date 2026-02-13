"use strict";
// ============================================================
// OrgsLedger API — Paystack Payment Service
// https://paystack.com/docs/api/
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.paystackService = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const crypto_1 = __importDefault(require("crypto"));
const PAYSTACK_BASE = 'https://api.paystack.co';
class PaystackService {
    client = null;
    getClient() {
        if (!config_1.config.paystack.secretKey)
            return null;
        if (!this.client) {
            this.client = axios_1.default.create({
                baseURL: PAYSTACK_BASE,
                headers: {
                    Authorization: `Bearer ${config_1.config.paystack.secretKey}`,
                    'Content-Type': 'application/json',
                },
            });
        }
        return this.client;
    }
    isConfigured() {
        return !!config_1.config.paystack.secretKey;
    }
    /**
     * Initialize a transaction — returns an authorization URL
     * for the user to complete payment in a WebView/browser.
     */
    async initializeTransaction(params) {
        const client = this.getClient();
        if (!client)
            throw new Error('Paystack not configured');
        const { data } = await client.post('/transaction/initialize', {
            email: params.email,
            amount: params.amount, // already in subunit
            currency: params.currency.toUpperCase(),
            reference: params.reference,
            callback_url: params.callbackUrl || `${config_1.config.apiUrl}/api/payments/paystack/callback`,
            metadata: params.metadata || {},
        });
        if (!data.status)
            throw new Error(data.message || 'Paystack initialization failed');
        return {
            authorizationUrl: data.data.authorization_url,
            accessCode: data.data.access_code,
            reference: data.data.reference,
        };
    }
    /**
     * Verify a transaction by reference.
     */
    async verifyTransaction(reference) {
        const client = this.getClient();
        if (!client)
            throw new Error('Paystack not configured');
        const { data } = await client.get(`/transaction/verify/${encodeURIComponent(reference)}`);
        if (!data.status)
            throw new Error(data.message || 'Verification failed');
        return {
            status: data.data.status, // 'success', 'failed', 'abandoned'
            reference: data.data.reference,
            amount: data.data.amount,
            currency: data.data.currency,
            gatewayResponse: data.data.gateway_response,
            paidAt: data.data.paid_at,
            channel: data.data.channel, // 'card', 'bank', 'ussd', etc.
            metadata: data.data.metadata,
        };
    }
    /**
     * Initiate a refund.
     */
    async createRefund(params) {
        const client = this.getClient();
        if (!client)
            throw new Error('Paystack not configured');
        const { data } = await client.post('/refund', {
            transaction: params.transactionReference,
            amount: params.amount,
            merchant_note: params.reason || 'Refund requested',
        });
        if (!data.status)
            throw new Error(data.message || 'Refund failed');
        return {
            refundId: data.data.id,
            status: data.data.status, // 'pending', 'processed'
            amount: data.data.amount,
        };
    }
    /**
     * Validate a Paystack webhook signature.
     */
    validateWebhook(body, signature) {
        const hash = crypto_1.default
            .createHmac('sha512', config_1.config.paystack.secretKey)
            .update(body)
            .digest('hex');
        return hash === signature;
    }
}
exports.paystackService = new PaystackService();
//# sourceMappingURL=paystack.service.js.map