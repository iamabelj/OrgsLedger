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
const validators_1 = require("../utils/validators");
const PAYSTACK_BASE = 'https://api.paystack.co';
class PaystackService {
    /** Global singleton client (env-var keys) */
    globalClient = null;
    /** Build an authenticated Axios client for a given secret key. */
    buildClient(secretKey) {
        return axios_1.default.create({
            baseURL: PAYSTACK_BASE,
            headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/json',
            },
        });
    }
    /**
     * Get an Axios client.
     * If an org-level secret key is provided it takes priority;
     * otherwise falls back to the platform-level env-var key.
     */
    getClient(orgSecretKey) {
        const key = orgSecretKey || config_1.config.paystack.secretKey;
        if (!key)
            return null;
        // Org-level keys always get a fresh client (different orgs = different keys)
        if (orgSecretKey)
            return this.buildClient(orgSecretKey);
        // Global singleton
        if (!this.globalClient) {
            this.globalClient = this.buildClient(key);
        }
        return this.globalClient;
    }
    isConfigured(orgSecretKey) {
        return !!(orgSecretKey || config_1.config.paystack.secretKey);
    }
    /**
     * Initialize a transaction — returns an authorization URL
     * for the user to complete payment in a WebView/browser.
     */
    async initializeTransaction(params) {
        const client = this.getClient(params.orgSecretKey);
        if (!client)
            throw new Error('Paystack not configured');
        const { data } = await client.post('/transaction/initialize', {
            email: params.email,
            amount: params.amount,
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
    async verifyTransaction(reference, orgSecretKey) {
        const client = this.getClient(orgSecretKey);
        if (!client)
            throw new Error('Paystack not configured');
        const { data } = await client.get(`/transaction/verify/${encodeURIComponent(reference)}`);
        if (!data.status)
            throw new Error(data.message || 'Verification failed');
        return {
            status: data.data.status,
            reference: data.data.reference,
            amount: data.data.amount,
            currency: data.data.currency,
            gatewayResponse: data.data.gateway_response,
            paidAt: data.data.paid_at,
            channel: data.data.channel,
            metadata: data.data.metadata,
        };
    }
    /**
     * Initiate a refund.
     */
    async createRefund(params) {
        const client = this.getClient(params.orgSecretKey);
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
            status: data.data.status,
            amount: data.data.amount,
        };
    }
    /**
     * Validate a Paystack webhook signature.
     * Supports per-org secret keys for multi-tenant webhook verification.
     */
    validateWebhook(body, signature, orgSecretKey) {
        const key = orgSecretKey || config_1.config.paystack.secretKey;
        if (!key)
            return false;
        const hash = crypto_1.default
            .createHmac('sha512', key)
            .update(body)
            .digest('hex');
        return (0, validators_1.timingSafeCompare)(hash, signature);
    }
}
exports.paystackService = new PaystackService();
//# sourceMappingURL=paystack.service.js.map