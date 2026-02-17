// ============================================================
// OrgsLedger Mobile — useOrgCurrency Hook
// Reads the current org's currency setting from the API and
// caches it in a small Zustand store so every screen shares it.
// ============================================================

import { useEffect } from 'react';
import { create } from 'zustand';
import { useAuthStore } from '../stores/auth.store';
import { api } from '../api/client';

interface OrgCurrencyState {
  /** ISO currency code for the current org */
  currency: string;
  /** The org id this cache belongs to */
  cachedOrgId: string | null;
  /** Whether a fetch is in progress */
  loading: boolean;
  /** Fetch currency for the given org */
  load: (orgId: string) => Promise<void>;
  /** Update currency locally (e.g. after settings save) */
  setCurrency: (code: string) => void;
}

export const useOrgCurrencyStore = create<OrgCurrencyState>((set, get) => ({
  currency: 'USD',
  cachedOrgId: null,
  loading: false,

  load: async (orgId: string) => {
    // Skip if already cached for this org
    if (get().cachedOrgId === orgId && !get().loading) return;

    set({ loading: true });
    try {
      const res = await api.orgs.get(orgId);
      const org = res.data?.data || res.data;

      let settings: any = {};
      if (org?.settings) {
        try {
          settings = typeof org.settings === 'string'
            ? JSON.parse(org.settings)
            : org.settings;
        } catch { settings = {}; }
      }

      const currency = settings.currency || org?.billing_currency || org?.currency || 'USD';
      set({ currency, cachedOrgId: orgId, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setCurrency: (code: string) => set({ currency: code }),
}));

/**
 * Returns the org's configured currency code (e.g. 'NGN', 'USD').
 * Automatically fetches from the API on first use and caches it.
 */
export function useOrgCurrency(): string {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const { currency, cachedOrgId, load } = useOrgCurrencyStore();

  useEffect(() => {
    if (currentOrgId && currentOrgId !== cachedOrgId) {
      load(currentOrgId);
    }
  }, [currentOrgId]);

  return currency;
}
