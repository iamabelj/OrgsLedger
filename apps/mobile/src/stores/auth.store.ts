// ============================================================
// OrgsLedger Mobile — Auth Store (Zustand)
// ============================================================

import { create } from 'zustand';
import storage from '../utils/storage';
import { api } from '../api/client';
import { socketClient } from '../api/socket';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatarUrl?: string;
  globalRole: string;
}

interface Membership {
  id: string;
  role: string;
  organization_id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
}

interface AuthState {
  user: User | null;
  memberships: Membership[];
  isLoading: boolean;
  isAuthenticated: boolean;
  currentOrgId: string | null;

  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; firstName: string; lastName: string; phone?: string; orgSlug?: string }) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  setCurrentOrg: (orgId: string) => void;
  resetAuth: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  memberships: [],
  isLoading: true,
  isAuthenticated: false,
  currentOrgId: null,

  login: async (email, password) => {
    const { data } = await api.auth.login({ email, password });
    const result = data.data;

    await storage.setItemAsync('accessToken', result.accessToken);
    await storage.setItemAsync('refreshToken', result.refreshToken);

    // Normalize membership fields (API may return snake_case)
    const memberships = (result.memberships || []).map((m: any) => ({
      ...m,
      organization_id: m.organization_id || m.organizationId,
      organizationId: m.organizationId || m.organization_id,
    }));

    set({
      user: result.user,
      memberships,
      isAuthenticated: true,
      currentOrgId: memberships[0]?.organization_id || null,
    });

    // Connect socket in background (don't await)
    socketClient.connect().catch(() => {});
  },

  register: async (regData) => {
    const { data } = await api.auth.register(regData);
    const result = data.data;

    await storage.setItemAsync('accessToken', result.accessToken);
    await storage.setItemAsync('refreshToken', result.refreshToken);

    // Normalize membership fields (API may return snake_case)
    const memberships = (result.memberships || []).map((m: any) => ({
      ...m,
      organization_id: m.organization_id || m.organizationId,
      organizationId: m.organizationId || m.organization_id,
    }));

    set({
      user: result.user,
      memberships,
      isAuthenticated: true,
      currentOrgId: memberships[0]?.organization_id || null,
    });

    // Connect socket in background (don't await)
    socketClient.connect().catch(() => {});
  },

  logout: async () => {
    socketClient.disconnect();
    await api.clearAuth();
    set({
      user: null,
      memberships: [],
      isAuthenticated: false,
      currentOrgId: null,
    });
  },

  loadUser: async () => {
    try {
      const token = await storage.getItemAsync('accessToken');
      if (!token) {
        set({ isLoading: false, isAuthenticated: false });
        return;
      }

      const { data } = await api.auth.me();
      const result = data.data;

      const savedOrgId = await storage.getItemAsync('currentOrgId');

      // Normalize membership fields
      const memberships = (result.memberships || []).map((m: any) => ({
        ...m,
        organization_id: m.organization_id || m.organizationId,
        organizationId: m.organizationId || m.organization_id,
      }));

      set({
        user: {
          id: result.id,
          email: result.email,
          firstName: result.firstName,
          lastName: result.lastName,
          phone: result.phone,
          avatarUrl: result.avatarUrl,
          globalRole: result.globalRole,
        },
        memberships,
        isAuthenticated: true,
        isLoading: false,
        currentOrgId: savedOrgId || memberships[0]?.organization_id || null,
      });

      // Connect socket in background (don't await)
      socketClient.connect().catch(() => {});
    } catch (err) {
      await api.clearAuth();
      set({ isLoading: false, isAuthenticated: false });
    }
  },

  setCurrentOrg: (orgId) => {
    set({ currentOrgId: orgId });
    storage.setItemAsync('currentOrgId', orgId);
  },

  resetAuth: () => {
    set({
      user: null,
      memberships: [],
      isAuthenticated: false,
      isLoading: false,
      currentOrgId: null,
    });
  },
}));
