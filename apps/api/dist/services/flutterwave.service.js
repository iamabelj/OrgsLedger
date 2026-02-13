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
const config_1 = require("../config");
const FLW_BASE = 'https://api.flutterwave.com/v3';
class FlutterwaveService {
    client = null;
    getClient() {
        if (!config_1.config.flutterwave.secretKey)
            return null;
        if (!this.client) {
            this.client = axios_1.default.create({
                baseURL: FLW_BASE,
                headers: {
                    Authorization: `Bearer ${config_1.config.flutterwave.secretKey}`,
                    'Content-Type': 'application/json',
                },
            });
        }
        return this.client;
    }
    isConfigured() {
        return !!config_1.config.flutterwave.secretKey;
    }
    /**
     * Initialize a standard payment — returns a hosted payment link.
     */
    async initializePayment(params) {
        const client = this.getClient();
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
    async verifyTransaction(transactionId) {
        const client = this.getClient();
        if (!client)
            throw new Error('Flutterwave not configured');
        const { data } = await client.get(`/transactions/${transactionId}/verify`);
        if (data.status !== 'success') {
            throw new Error(data.message || 'Verification failed');
        }
        return {
            status: data.data.status, // 'successful', 'failed', 'pending'
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
        const client = this.getClient();
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
            status: data.data.status, // 'completed', 'pending'
            amountRefunded: data.data.amount_refunded,
        };
    }
    /**
     * Validate a Flutterwave webhook request.
     */
    validateWebhook(secretHash) {
        return secretHash === config_1.config.flutterwave.webhookHash;
    }
}
exports.flutterwaveService = new FlutterwaveService();
//# sourceMappingURL=flutterwave.service.js.map