// ============================================================
// OrgsLedger API — Paystack Payment Service
// https://paystack.com/docs/api/
// ============================================================

import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import crypto from 'crypto';
import { timingSafeCompare } from '../utils/validators';

const PAYSTACK_BASE = 'https://api.paystack.co';

class PaystackService {
  /** Global singleton client (env-var keys) */
  private globalClient: AxiosInstance | null = null;

  /** Build an authenticated Axios client for a given secret key. */
  private buildClient(secretKey: string): AxiosInstance {
    return axios.create({
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
  getClient(orgSecretKey?: string): AxiosInstance | null {
    const key = orgSecretKey || config.paystack.secretKey;
    if (!key) return null;

    // Org-level keys always get a fresh client (different orgs = different keys)
    if (orgSecretKey) return this.buildClient(orgSecretKey);

    // Global singleton
    if (!this.globalClient) {
      this.globalClient = this.buildClient(key);
    }
    return this.globalClient;
  }

  isConfigured(orgSecretKey?: string): boolean {
    return !!(orgSecretKey || config.paystack.secretKey);
  }

  /**
   * Initialize a transaction — returns an authorization URL
   * for the user to complete payment in a WebView/browser.
   */
  async initializeTransaction(params: {
    email: string;
    amount: number;
    currency: string;
    reference: string;
    callbackUrl?: string;
    metadata?: Record<string, any>;
    orgSecretKey?: string;
  }) {
    const client = this.getClient(params.orgSecretKey);
    if (!client) throw new Error('Paystack not configured');

    const { data } = await client.post('/transaction/initialize', {
      email: params.email,
      amount: params.amount,
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
  async verifyTransaction(reference: string, orgSecretKey?: string) {
    const client = this.getClient(orgSecretKey);
    if (!client) throw new Error('Paystack not configured');

    const { data } = await client.get(`/transaction/verify/${encodeURIComponent(reference)}`);

    if (!data.status) throw new Error(data.message || 'Verification failed');

    return {
      status: data.data.status as string,
      reference: data.data.reference as string,
      amount: data.data.amount as number,
      currency: data.data.currency as string,
      gatewayResponse: data.data.gateway_response as string,
      paidAt: data.data.paid_at as string | null,
      channel: data.data.channel as string,
      metadata: data.data.metadata,
    };
  }

  /**
   * Initiate a refund.
   */
  async createRefund(params: {
    transactionReference: string;
    amount?: number;
    reason?: string;
    orgSecretKey?: string;
  }) {
    const client = this.getClient(params.orgSecretKey);
    if (!client) throw new Error('Paystack not configured');

    const { data } = await client.post('/refund', {
      transaction: params.transactionReference,
      amount: params.amount,
      merchant_note: params.reason || 'Refund requested',
    });

    if (!data.status) throw new Error(data.message || 'Refund failed');

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
  validateWebhook(body: string | Buffer, signature: string, orgSecretKey?: string): boolean {
    const key = orgSecretKey || config.paystack.secretKey;
    if (!key) return false;
    const hash = crypto
      .createHmac('sha512', key)
      .update(body)
      .digest('hex');
    return timingSafeCompare(hash, signature);
  }
}

export const paystackService = new PaystackService();
