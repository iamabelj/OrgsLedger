// ============================================================
// OrgsLedger API — Flutterwave Payment Service
// https://developer.flutterwave.com/reference
// ============================================================

import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { config } from '../config';

const FLW_BASE = 'https://api.flutterwave.com/v3';

class FlutterwaveService {
  private client: AxiosInstance | null = null;

  private getClient(): AxiosInstance | null {
    if (!config.flutterwave.secretKey) return null;
    if (!this.client) {
      this.client = axios.create({
        baseURL: FLW_BASE,
        headers: {
          Authorization: `Bearer ${config.flutterwave.secretKey}`,
          'Content-Type': 'application/json',
        },
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return !!config.flutterwave.secretKey;
  }

  /**
   * Initialize a standard payment — returns a hosted payment link.
   */
  async initializePayment(params: {
    txRef: string;
    amount: number; // in major currency unit (e.g. 100.00)
    currency: string;
    customerEmail: string;
    customerName?: string;
    redirectUrl?: string;
    meta?: Record<string, any>;
    title?: string;
    description?: string;
  }) {
    const client = this.getClient();
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
  async verifyTransaction(transactionId: string | number) {
    const client = this.getClient();
    if (!client) throw new Error('Flutterwave not configured');

    const { data } = await client.get(`/transactions/${transactionId}/verify`);

    if (data.status !== 'success') {
      throw new Error(data.message || 'Verification failed');
    }

    return {
      status: data.data.status as string, // 'successful', 'failed', 'pending'
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
    amount?: number; // partial refund; omit for full
    reason?: string;
  }) {
    const client = this.getClient();
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
      status: data.data.status, // 'completed', 'pending'
      amountRefunded: data.data.amount_refunded,
    };
  }

  /**
   * Validate a Flutterwave webhook request.
   * Checks the verif-hash header using timing-safe comparison against the configured webhook hash.
   */
  validateWebhook(secretHash: string): boolean {
    if (!config.flutterwave.webhookHash || !secretHash) return false;
    try {
      const expected = Buffer.from(config.flutterwave.webhookHash, 'utf-8');
      const received = Buffer.from(secretHash, 'utf-8');
      if (expected.length !== received.length) return false;
      return crypto.timingSafeEqual(expected, received);
    } catch {
      return false;
    }
  }
}

export const flutterwaveService = new FlutterwaveService();
