// ============================================================
// OrgsLedger Mobile — Financials Store (Zustand)
// ============================================================

import { create } from 'zustand';
import { api } from '../api/client';
import { socketClient } from '../api/socket';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  currency: string;
  status: string;
  description: string;
  created_at: string;
  first_name?: string;
  last_name?: string;
}

interface LedgerSummary {
  totalDuesCollected: number;
  totalFinesCollected: number;
  totalDonations: number;
  totalRefunds: number;
  grandTotal: number;
  // Computed convenience properties
  totalIncome: number;
  pendingAmount: number;
  netBalance: number;
}

interface FinancialState {
  transactions: Transaction[];
  summary: LedgerSummary | null;
  dues: any[];
  fines: any[];
  userHistory: {
    transactions: Transaction[];
    totalOutstanding: number;
    totalPaid: number;
  } | null;
  isLoading: boolean;
  page: number;
  totalCount: number;

  loadLedger: (orgId: string, params?: any) => Promise<void>;
  loadDues: (orgId: string) => Promise<void>;
  loadFines: (orgId: string) => Promise<void>;
  loadUserHistory: (orgId: string, userId: string) => Promise<void>;
  payTransaction: (orgId: string, transactionId: string, gateway?: string) => Promise<void>;
  subscribeLedger: (orgId: string) => void;
}

export const useFinancialStore = create<FinancialState>((set, get) => ({
  transactions: [],
  summary: null,
  dues: [],
  fines: [],
  userHistory: null,
  isLoading: false,
  page: 1,
  totalCount: 0,

  loadLedger: async (orgId, params) => {
    try {
      set({ isLoading: true });
      const { data } = await api.financials.getLedger(orgId, params);
      const rawSummary = data.data.summary;
      const totalDues = parseFloat(rawSummary.total_dues_collected) || 0;
      const totalFines = parseFloat(rawSummary.total_fines_collected) || 0;
      const totalDonations = parseFloat(rawSummary.total_donations) || 0;
      const totalRefunds = parseFloat(rawSummary.total_refunds) || 0;
      const grandTotal = parseFloat(rawSummary.grand_total) || 0;
      const totalIncome = totalDues + totalFines + totalDonations;

      set({
        transactions: data.data.transactions,
        summary: {
          totalDuesCollected: totalDues,
          totalFinesCollected: totalFines,
          totalDonations,
          totalRefunds,
          grandTotal,
          totalIncome,
          pendingAmount: Math.max(0, totalIncome - grandTotal),
          netBalance: grandTotal,
        },
        page: data.meta.page,
        totalCount: data.meta.total,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false });
      console.error('Failed to load ledger', err);
    }
  },

  loadDues: async (orgId) => {
    try {
      const { data } = await api.financials.getDues(orgId);
      set({ dues: data.data });
    } catch (err) {
      console.error('Failed to load dues', err);
    }
  },

  loadFines: async (orgId) => {
    try {
      const { data } = await api.financials.getFines(orgId);
      set({ fines: data.data });
    } catch (err) {
      console.error('Failed to load fines', err);
    }
  },

  loadUserHistory: async (orgId, userId) => {
    try {
      set({ isLoading: true });
      const { data } = await api.financials.getUserHistory(orgId, userId);
      set({
        userHistory: {
          transactions: data.data.transactions,
          totalOutstanding: parseFloat(data.data.totalOutstanding),
          totalPaid: parseFloat(data.data.totalPaid),
        },
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false });
      console.error('Failed to load user history', err);
    }
  },

  payTransaction: async (orgId, transactionId, gateway = 'stripe') => {
    await api.payments.pay(orgId, { transactionId, gateway });
    // Reload after payment
    const { loadLedger } = get();
    await loadLedger(orgId);
  },

  subscribeLedger: (orgId) => {
    socketClient.subscribeLedger(orgId);
  },
}));
