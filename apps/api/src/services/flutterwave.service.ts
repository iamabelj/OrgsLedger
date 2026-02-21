// ============================================================
// OrgsLedger API — Flutterwave Payment Service
// https://developer.flutterwave.com/reference
// ============================================================

import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { config } from '../config';

const FLW_BASE = 'https://api.flutterwave.com/v3';

class FlutterwaveService {
  /** Global singleton client (env-var keys) */
  private globalClient: AxiosInstance | null = null;

  /** Build an authenticated Axios client for a given secret key. */
  private buildClient(secretKey: string): AxiosInstance {
    return axios.create({
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
  getClient(orgSecretKey?: string): AxiosInstance | null {
    const key = orgSecretKey || config.flutterwave.secretKey;
    if (!key) return null;

    if (orgSecretKey) return this.buildClient(orgSecretKey);

    if (!this.globalClient) {
      this.globalClient = this.buildClient(key);
    }
    return this.globalClient;
  }

  isConfigured(orgSecretKey?: string): boolean {
    return !!(orgSecretKey || config.flutterwave.secretKey);
  }

  /**
   * Initialize a standard payment — returns a hosted payment link.
   */
  async initializePayment(params: {
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
  }) {
    const client = this.getClient(params.orgSecretKey);
    if (!client) throw new Error('Flutterwave not configured');

    const payload: any = {
      tx_ref: params.txRef,
      amount: params.amount,
      currency: params.currency.toUpperCase(),
      redirect_url: params.redirectUrl || `${config.apiUrl}/api/payments/flutterwave/callback`,
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
      paymentLink: data.data.link as string,
      txRef: params.txRef,
    };
  }

  /**
   * Verify a transaction by its Flutterwave transaction ID.
   */
  async verifyTransaction(transactionId: string | number, orgSecretKey?: string) {
    const client = this.getClient(orgSecretKey);
    if (!client) throw new Error('Flutterwave not configured');

    const { data } = await client.get(`/transactions/${transactionId}/verify`);

    if (data.status !== 'success') {
      throw new Error(data.message || 'Verification failed');
    }

    return {
      status: data.data.status as string,
      txRef: data.data.tx_ref as string,
      flwRef: data.data.flw_ref as string,
      amount: data.data.amount as number,
      currency: data.data.currency as string,
      chargedAmount: data.data.charged_amount as number,
      paymentType: data.data.payment_type as string,
      customerEmail: data.data.customer?.email,
      meta: data.data.meta,
    };
  }

  /**
   * Initiate a refund.
   */
  async createRefund(params: {
    transactionId: number | string;
    amount?: number;
    reason?: string;
    orgSecretKey?: string;
  }) {
    const client = this.getClient(params.orgSecretKey);
    if (!client) throw new Error('Flutterwave not configured');

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
  validateWebhook(secretHash: string, orgWebhookHash?: string): boolean {
    const expected = orgWebhookHash || config.flutterwave.webhookHash;
    if (!expected || !secretHash) return false;
    try {
      const expectedBuf = Buffer.from(expected, 'utf-8');
      const receivedBuf = Buffer.from(secretHash, 'utf-8');
      if (expectedBuf.length !== receivedBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, receivedBuf);
    } catch {
      return false;
    }
  }
}

export const flutterwaveService = new FlutterwaveService();
