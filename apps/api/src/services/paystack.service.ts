// ============================================================
// OrgsLedger API — Paystack Payment Service
// https://paystack.com/docs/api/
// ============================================================

import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import crypto from 'crypto';

const PAYSTACK_BASE = 'https://api.paystack.co';

class PaystackService {
  private client: AxiosInstance | null = null;

  private getClient(): AxiosInstance | null {
    if (!config.paystack.secretKey) return null;
    if (!this.client) {
      this.client = axios.create({
        baseURL: PAYSTACK_BASE,
        headers: {
          Authorization: `Bearer ${config.paystack.secretKey}`,
          'Content-Type': 'application/json',
        },
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return !!config.paystack.secretKey;
  }

  /**
   * Initialize a transaction — returns an authorization URL
   * for the user to complete payment in a WebView/browser.
   */
  async initializeTransaction(params: {
    email: string;
    amount: number; // in the smallest currency unit (kobo for NGN, cents for USD, etc.)
    currency: string;
    reference: string;
    callbackUrl?: string;
    metadata?: Record<string, any>;
  }) {
    const client = this.getClient();
    if (!client) throw new Error('Paystack not configured');

    const { data } = await client.post('/transaction/initialize', {
      email: params.email,
      amount: params.amount, // already in subunit
      currency: params.currency.toUpperCase(),
      reference: params.reference,
      callback_url: params.callbackUrl || `${config.apiUrl}/api/payments/paystack/callback`,
      metadata: params.metadata || {},
    });

    if (!data.status) throw new Error(data.message || 'Paystack initialization failed');

    return {
      authorizationUrl: data.data.authorization_url as string,
      accessCode: data.data.access_code as string,
      reference: data.data.reference as string,
    };
  }

  /**
   * Verify a transaction by reference.
   */
  async verifyTransaction(reference: string) {
    const client = this.getClient();
    if (!client) throw new Error('Paystack not configured');

    const { data } = await client.get(`/transaction/verify/${encodeURIComponent(reference)}`);

    if (!data.status) throw new Error(data.message || 'Verification failed');

    return {
      status: data.data.status as string, // 'success', 'failed', 'abandoned'
      reference: data.data.reference as string,
      amount: data.data.amount as number,
      currency: data.data.currency as string,
      gatewayResponse: data.data.gateway_response as string,
      paidAt: data.data.paid_at as string | null,
      channel: data.data.channel as string, // 'card', 'bank', 'ussd', etc.
      metadata: data.data.metadata,
    };
  }

  /**
   * Initiate a refund.
   */
  async createRefund(params: {
    transactionReference: string;
    amount?: number; // partial refund in subunit; omit for full refund
    reason?: string;
  }) {
    const client = this.getClient();
    if (!client) throw new Error('Paystack not configured');

    const { data } = await client.post('/refund', {
      transaction: params.transactionReference,
      amount: params.amount,
      merchant_note: params.reason || 'Refund requested',
    });

    if (!data.status) throw new Error(data.message || 'Refund failed');

    return {
      refundId: data.data.id,
      status: data.data.status, // 'pending', 'processed'
      amount: data.data.amount,
    };
  }

  /**
   * Validate a Paystack webhook signature.
   */
  validateWebhook(body: string | Buffer, signature: string): boolean {
    const hash = crypto
      .createHmac('sha512', config.paystack.secretKey)
      .update(body)
      .digest('hex');
    return hash === signature;
  }
}

export const paystackService = new PaystackService();
