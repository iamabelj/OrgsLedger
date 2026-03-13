"use strict";
// ============================================================
// OrgsLedger API — Flutterwave Payment Service
// https://developer.flutterwave.com/reference
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.flutterwaveService = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const FLW_BASE = 'https://api.flutterwave.com/v3';
class FlutterwaveService {
    /** Global singleton client (env-var keys) */
    globalClient = null;
    /** Build an authenticated Axios client for a given secret key. */
    buildClient(secretKey) {
        return axios_1.default.create({
            baseURL: FLW_BASE,
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
        const key = orgSecretKey || config_1.config.flutterwave.secretKey;
        if (!key)
            return null;
        if (orgSecretKey)
            return this.buildClient(orgSecretKey);
        if (!this.globalClient) {
            this.globalClient = this.buildClient(key);
        }
        return this.globalClient;
    }
    isConfigured(orgSecretKey) {
        return !!(orgSecretKey || config_1.config.flutterwave.secretKey);
    }
    /**
     * Initialize a standard payment — returns a hosted payment link.
     */
    async initializePayment(params) {
        const client = this.getClient(params.orgSecretKey);
        if (!client)
            throw new Error('Flutterwave not configured');
        const payload = {
            tx_ref: params.txRef,
            amount: params.amount,
            currency: params.currency.toUpperCase(),
            redirect_url: params.redirectUrl || `${config_1.config.apiUrl}/api/payments/flutterwave/callback`,
            customer: {
                email: params.customerEmail,
                name: params.customerName || undefined,
            },
            customizations: {
                title: params.title || 'OrgsLedger Payment',
                description: params.description || '',
            },
            meta: params.meta || {},
        };
        const { data } = await client.post('/payments', payload);
        if (data.status !== 'success') {
            throw new Error(data.message || 'Flutterwave payment initialization failed');
        }
        return {
            paymentLink: data.data.link,
            txRef: params.txRef,
        };
    }
    /**
     * Verify a transaction by its Flutterwave transaction ID.
     */
    async verifyTransaction(transactionId, orgSecretKey) {
        const client = this.getClient(orgSecretKey);
        if (!client)
            throw new Error('Flutterwave not configured');
        const { data } = await client.get(`/transactions/${transactionId}/verify`);
        if (data.status !== 'success') {
            throw new Error(data.message || 'Verification failed');
        }
        return {
            status: data.data.status,
            txRef: data.data.tx_ref,
            flwRef: data.data.flw_ref,
            amount: data.data.amount,
            currency: data.data.currency,
            chargedAmount: data.data.charged_amount,
            paymentType: data.data.payment_type,
            customerEmail: data.data.customer?.email,
            meta: data.data.meta,
        };
    }
    /**
     * Initiate a refund.
     */
    async createRefund(params) {
        const client = this.getClient(params.orgSecretKey);
        if (!client)
            throw new Error('Flutterwave not configured');
        const { data } = await client.post('/refunds', {
            id: params.transactionId,
            amount: params.amount,
            comments: params.reason || 'Refund requested',
        });
        if (data.status !== 'success') {
            throw new Error(data.message || 'Refund failed');
        }
        return {
            refundId: data.data.id,
            status: data.data.status,
            amountRefunded: data.data.amount_refunded,
        };
    }
    /**
     * Validate a Flutterwave webhook request.
     * Supports per-org webhook hash for multi-tenant verification.
     */
    validateWebhook(secretHash, orgWebhookHash) {
        const expected = orgWebhookHash || config_1.config.flutterwave.webhookHash;
        if (!expected || !secretHash)
            return false;
        try {
            const expectedBuf = Buffer.from(expected, 'utf-8');
            const receivedBuf = Buffer.from(secretHash, 'utf-8');
            if (expectedBuf.length !== receivedBuf.length)
                return false;
            return crypto_1.default.timingSafeEqual(expectedBuf, receivedBuf);
        }
        catch {
            return false;
        }
    }
}
exports.flutterwaveService = new FlutterwaveService();
//# sourceMappingURL=flutterwave.service.js.map