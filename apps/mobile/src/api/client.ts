// ============================================================
// OrgsLedger Mobile — API Client
// ============================================================

import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import storage from '../utils/storage';

// Auto-detect API URL:
//   Web  → same origin (API serves the SPA, so /api always works)
//   Native dev → localhost
//   Native prod → production domain
function getApiBaseUrl(): string {
  if (Platform.OS === 'web') {
    // On web the Express server serves both the SPA and the API,
    // so we always use the current origin — works for localhost AND production.
    if (typeof window !== 'undefined' && window.location) {
      return `${window.location.origin}/api`;
    }
    return '/api'; // SSR / node fallback
  }
  // Native
  if (__DEV__) return 'http://localhost:3000/api';
  return 'https://app.orgsledger.com/api';
}

const API_BASE_URL = getApiBaseUrl();

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Request interceptor — attach auth token
    this.client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
      const token = await storage.getItemAsync('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Response interceptor — handle token refresh + startup retries
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;

        // ── Retry on 503 (server starting up) ──
        // Hostinger returns 503 or our loading handler returns it while API boots.
        if (error.response?.status === 503 && (!config._retryCount || config._retryCount < 3)) {
          config._retryCount = (config._retryCount || 0) + 1;
          await new Promise(r => setTimeout(r, 1500 * config._retryCount));
          return this.client(config);
        }

        // ── Detect HTML response (server proxy error page) ──
        // If we got HTML instead of JSON, the server is likely down or restarting
        if (!error.response && error.message?.includes('is not valid JSON')) {
          error.message = 'Server is temporarily unavailable. Please try again in a moment.';
          return Promise.reject(error);
        }

        if (error.response?.status === 401) {
          const refreshToken = await storage.getItemAsync('refreshToken');
          if (refreshToken) {
            try {
              const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
                refreshToken,
              });
              await storage.setItemAsync('accessToken', data.data.accessToken);
              await storage.setItemAsync('refreshToken', data.data.refreshToken);
              error.config.headers.Authorization = `Bearer ${data.data.accessToken}`;
              return this.client(error.config);
            } catch {
              await this.clearAuth();
              // Reset auth store on refresh failure
              try {
                const { useAuthStore } = require('../stores/auth.store');
                useAuthStore.getState().resetAuth();
              } catch {}
            }
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async clearAuth() {
    await storage.deleteItemAsync('accessToken');
    await storage.deleteItemAsync('refreshToken');
  }

  // ── Auth ──────────────────────────────────────────────
  auth = {
    register: (data: { email: string; password: string; firstName: string; lastName: string; phone?: string; orgSlug?: string; inviteCode: string }) =>
      this.client.post('/auth/register', data),
    adminRegister: (data: {
      email: string; password: string; firstName: string; lastName: string;
      phone?: string; orgName: string; orgSlug: string;
      plan?: string; billingCycle?: string; billingRegion?: string; currency?: string;
    }) => this.client.post('/auth/admin-register', data),
    registerWithInvite: (data: {
      email: string; password: string; firstName: string; lastName: string;
      phone?: string; inviteCode: string;
    }) => this.client.post('/auth/register-with-invite', data),
    login: (data: { email: string; password: string }) =>
      this.client.post('/auth/login', data),
    me: () => this.client.get('/auth/me'),
    updateProfile: (data: any) => this.client.put('/auth/me', data),
    updatePushToken: (data: { fcmToken?: string; apnsToken?: string }) =>
      this.client.put('/auth/push-token', data),
    forgotPassword: (data: { email: string }) =>
      this.client.post('/auth/forgot-password', data),
    resetPassword: (data: { email: string; code: string; newPassword: string }) =>
      this.client.post('/auth/reset-password', data),
    sendVerification: () => this.client.post('/auth/send-verification'),
    verifyEmail: (data: { code: string }) =>
      this.client.post('/auth/verify-email', data),
    changePassword: (data: { currentPassword: string; newPassword: string }) =>
      this.client.put('/auth/change-password', data),
    getLanguagePreference: (orgId: string) =>
      this.client.get(`/auth/language-preference/${orgId}`),
    setLanguagePreference: (orgId: string, data: { language: string; receiveVoice?: boolean }) =>
      this.client.put(`/auth/language-preference/${orgId}`, data),
    uploadAvatar: async (file: { uri: string; name: string; mimeType: string } | File) => {
      const formData = new FormData();
      if (typeof File !== 'undefined' && file instanceof File) {
        // Web: append native File object directly
        formData.append('avatar', file, file.name);
      } else {
        const f = file as { uri: string; name: string; mimeType: string };
        if (typeof window !== 'undefined') {
          // Web fallback: convert data-URI / blob-URL → File
          const resp = await fetch(f.uri);
          const blob = await resp.blob();
          const webFile = new File([blob], f.name, { type: f.mimeType });
          formData.append('avatar', webFile, f.name);
        } else {
          // React Native: URI-based upload
          formData.append('avatar', {
            uri: f.uri,
            name: f.name,
            type: f.mimeType,
          } as any);
        }
      }
      return this.client.post('/auth/upload-avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
  };

  // ── Organizations ─────────────────────────────────────
  orgs = {
    list: () => this.client.get('/organizations'),
    get: (orgId: string) => this.client.get(`/organizations/${orgId}`),
    create: (data: any) => this.client.post('/organizations', data),
    updateSettings: (orgId: string, data: any) =>
      this.client.put(`/organizations/${orgId}/settings`, data),
    listMembers: (orgId: string, params?: any) =>
      this.client.get(`/organizations/${orgId}/members`, { params }),
    addMember: (orgId: string, data: any) =>
      this.client.post(`/organizations/${orgId}/members`, data),
    updateMember: (orgId: string, userId: string, data: any) =>
      this.client.put(`/organizations/${orgId}/members/${userId}`, data),
    removeMember: (orgId: string, userId: string) =>
      this.client.delete(`/organizations/${orgId}/members/${userId}`),
    getMember: (orgId: string, userId: string) =>
      this.client.get(`/organizations/${orgId}/members/${userId}`),
    getMemberActivity: (orgId: string, userId: string, params?: any) =>
      this.client.get(`/organizations/${orgId}/members/${userId}/activity`, { params }),
    getAuditLogs: (orgId: string, params?: { page?: number; limit?: number; action?: string; entityType?: string }) =>
      this.client.get(`/organizations/${orgId}/audit-logs`, { params }),
    getEditHistory: (orgId: string, params?: { page?: number; limit?: number; entityType?: string; entityId?: string }) =>
      this.client.get(`/organizations/${orgId}/edit-history`, { params }),
    getSubscription: (orgId: string) =>
      this.client.get(`/organizations/${orgId}/subscription`),
    lookupBySlug: (slug: string) =>
      this.client.get(`/organizations/lookup/${slug}`),
    join: (orgId: string) =>
      this.client.post(`/organizations/${orgId}/join`),
    uploadLogo: async (orgId: string, file: { uri: string; name: string; mimeType: string } | File) => {
      const formData = new FormData();
      if (typeof File !== 'undefined' && file instanceof File) {
        formData.append('logo', file, file.name);
      } else {
        const f = file as { uri: string; name: string; mimeType: string };
        if (typeof window !== 'undefined') {
          const resp = await fetch(f.uri);
          const blob = await resp.blob();
          const webFile = new File([blob], f.name, { type: f.mimeType });
          formData.append('logo', webFile, f.name);
        } else {
          formData.append('logo', {
            uri: f.uri,
            name: f.name,
            type: f.mimeType,
          } as any);
        }
      }
      return this.client.post(`/organizations/${orgId}/logo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
  };

  // ── Chat ──────────────────────────────────────────────
  chat = {
    listChannels: (orgId: string) => this.client.get(`/chat/${orgId}/channels`),
    createChannel: (orgId: string, data: any) =>
      this.client.post(`/chat/${orgId}/channels`, data),
    getOrCreateDM: (orgId: string, targetUserId: string) =>
      this.client.post(`/chat/${orgId}/dm/${targetUserId}`),
    getMessages: (orgId: string, channelId: string, params?: any) =>
      this.client.get(`/chat/${orgId}/channels/${channelId}/messages`, { params }),
    sendMessage: (orgId: string, channelId: string, data: any) =>
      this.client.post(`/chat/${orgId}/channels/${channelId}/messages`, data),
    getThread: (orgId: string, channelId: string, messageId: string) =>
      this.client.get(`/chat/${orgId}/channels/${channelId}/messages/${messageId}/thread`),
    searchMessages: (orgId: string, query: string) =>
      this.client.get(`/chat/${orgId}/messages/search`, { params: { q: query } }),
    editMessage: (orgId: string, channelId: string, messageId: string, data: any) =>
      this.client.put(`/chat/${orgId}/channels/${channelId}/messages/${messageId}`, data),
    deleteMessage: (orgId: string, channelId: string, messageId: string) =>
      this.client.delete(`/chat/${orgId}/channels/${channelId}/messages/${messageId}`),
    markRead: (orgId: string, channelId: string) =>
      this.client.post(`/chat/${orgId}/channels/${channelId}/mark-read`),
    uploadFiles: async (orgId: string, channelId: string, files: ({ uri: string; name: string; mimeType: string } | File)[]) => {
      const formData = new FormData();
      for (const file of files) {
        if (typeof File !== 'undefined' && file instanceof File) {
          formData.append('files', file, file.name);
        } else {
          const f = file as { uri: string; name: string; mimeType: string };
          if (typeof window !== 'undefined') {
            // Web fallback: convert data-URI / blob-URL → File
            const resp = await fetch(f.uri);
            const blob = await resp.blob();
            const webFile = new File([blob], f.name, { type: f.mimeType });
            formData.append('files', webFile, f.name);
          } else {
            formData.append('files', {
              uri: f.uri,
              name: f.name,
              type: f.mimeType,
            } as any);
          }
        }
      }
      return this.client.post(`/chat/${orgId}/channels/${channelId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
  };

  // ── Meetings ──────────────────────────────────────────
  meetings = {
    list: (orgId: string, params?: any) =>
      this.client.get(`/meetings/${orgId}`, { params }),
    get: (orgId: string, meetingId: string) =>
      this.client.get(`/meetings/${orgId}/${meetingId}`),
    create: (orgId: string, data: any) =>
      this.client.post(`/meetings/${orgId}`, data),
    update: (orgId: string, meetingId: string, data: any) =>
      this.client.put(`/meetings/${orgId}/${meetingId}`, data),
    toggleAi: (orgId: string, meetingId: string) =>
      this.client.post(`/meetings/${orgId}/${meetingId}/toggle-ai`),
    start: (orgId: string, meetingId: string) =>
      this.client.post(`/meetings/${orgId}/${meetingId}/start`),
    end: (orgId: string, meetingId: string) =>
      this.client.post(`/meetings/${orgId}/${meetingId}/end`),
    join: (orgId: string, meetingId: string, joinType?: 'video' | 'audio') =>
      this.client.post(`/meetings/${orgId}/${meetingId}/join`, { joinType }),
    leave: (orgId: string, meetingId: string) =>
      this.client.post(`/meetings/${orgId}/${meetingId}/leave`),
    recordAttendance: (orgId: string, meetingId: string) =>
      this.client.post(`/meetings/${orgId}/${meetingId}/attendance`),
    createVote: (orgId: string, meetingId: string, data: any) =>
      this.client.post(`/meetings/${orgId}/${meetingId}/votes`, data),
    castVote: (orgId: string, meetingId: string, voteId: string, data: any) =>
      this.client.post(`/meetings/${orgId}/${meetingId}/votes/${voteId}/cast`, data),
    closeVote: (orgId: string, meetingId: string, voteId: string) =>
      this.client.post(`/meetings/${orgId}/${meetingId}/votes/${voteId}/close`),
    uploadAudio: (orgId: string, meetingId: string, fileUri: string, fileName: string) => {
      const formData = new FormData();
      formData.append('audio', {
        uri: fileUri,
        name: fileName,
        type: 'audio/m4a',
      } as any);
      return this.client.post(`/meetings/${orgId}/${meetingId}/audio`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
    },
    // Meeting transcripts (live translation history)
    getTranscripts: (orgId: string, meetingId: string) =>
      this.client.get(`/meetings/${orgId}/${meetingId}/transcripts`),
    // AI-generated minutes
    getMinutes: (orgId: string, meetingId: string) =>
      this.client.get(`/meetings/${orgId}/${meetingId}/minutes`),
    // Download minutes as text/json
    downloadMinutes: (orgId: string, meetingId: string, format: 'txt' | 'json' = 'txt') =>
      this.client.get(`/meetings/${orgId}/${meetingId}/minutes/download`, {
        params: { format },
        responseType: 'text',
      }),
    // Trigger AI minutes generation from live transcripts
    generateMinutes: (orgId: string, meetingId: string) =>
      this.client.post(`/meetings/${orgId}/${meetingId}/generate-minutes`),
    // In-meeting chat messages
    getChatMessages: (orgId: string, meetingId: string) =>
      this.client.get(`/meetings/${orgId}/${meetingId}/chat`),
  };

  // ── Financials ────────────────────────────────────────
  financials = {
    getDues: (orgId: string) => this.client.get(`/financials/${orgId}/dues`),
    createDue: (orgId: string, data: any) =>
      this.client.post(`/financials/${orgId}/dues`, data),
    updateDue: (orgId: string, dueId: string, data: any) =>
      this.client.put(`/financials/${orgId}/dues/${dueId}`, data),
    getFines: (orgId: string) => this.client.get(`/financials/${orgId}/fines`),
    createFine: (orgId: string, data: any) =>
      this.client.post(`/financials/${orgId}/fines`, data),
    updateFine: (orgId: string, fineId: string, data: any) =>
      this.client.put(`/financials/${orgId}/fines/${fineId}`, data),
    getCampaigns: (orgId: string) =>
      this.client.get(`/financials/${orgId}/donation-campaigns`),
    createCampaign: (orgId: string, data: any) =>
      this.client.post(`/financials/${orgId}/donation-campaigns`, data),
    updateCampaign: (orgId: string, campaignId: string, data: any) =>
      this.client.put(`/financials/${orgId}/donation-campaigns/${campaignId}`, data),
    makeDonation: (orgId: string, data: any) =>
      this.client.post(`/financials/${orgId}/donations`, data),
    getLedger: (orgId: string, params?: any) =>
      this.client.get(`/financials/${orgId}/ledger`, { params }),
    getUserHistory: (orgId: string, userId: string) =>
      this.client.get(`/financials/${orgId}/ledger/user/${userId}`),
    exportLedger: (orgId: string, params?: any) =>
      this.client.get(`/financials/${orgId}/ledger/export`, { params, responseType: 'text' }),
  };

  // ── Expenses ──────────────────────────────────────────
  expenses = {
    list: (orgId: string) => this.client.get(`/expenses/${orgId}`),
    create: (orgId: string, data: any) => this.client.post(`/expenses/${orgId}`, data),
    get: (orgId: string, expenseId: string) => this.client.get(`/expenses/${orgId}/${expenseId}`),
    update: (orgId: string, expenseId: string, data: any) =>
      this.client.put(`/expenses/${orgId}/${expenseId}`, data),
    delete: (orgId: string, expenseId: string) =>
      this.client.delete(`/expenses/${orgId}/${expenseId}`),
  };

  // ── Payments ──────────────────────────────────────────
  payments = {
    pay: (orgId: string, data: { transactionId: string; gateway: string; paymentMethodId?: string; proofOfPayment?: string }) =>
      this.client.post(`/payments/${orgId}/payments/pay`, data),
    setupIntent: (orgId: string) =>
      this.client.post(`/payments/${orgId}/payments/setup-intent`),
    getGateways: (orgId: string) =>
      this.client.get(`/payments/${orgId}/payments/gateways`),
    verify: (orgId: string, transactionId: string) =>
      this.client.get(`/payments/${orgId}/payments/verify/${transactionId}`),
    // Bank transfer admin
    getPendingTransfers: (orgId: string) =>
      this.client.get(`/payments/${orgId}/payments/pending-transfers`),
    approveTransfer: (orgId: string, data: { transactionId: string; approved: boolean }) =>
      this.client.post(`/payments/${orgId}/payments/approve-transfer`, data),
    // Payment method config
    getPaymentMethods: (orgId: string) =>
      this.client.get(`/payments/${orgId}/payments/methods`),
    updatePaymentMethods: (orgId: string, paymentMethods: any) =>
      this.client.put(`/payments/${orgId}/payments/methods`, { paymentMethods }),
  };

  // ── Committees ────────────────────────────────────────
  committees = {
    list: (orgId: string) => this.client.get(`/committees/${orgId}/committees`),
    get: (orgId: string, committeeId: string) =>
      this.client.get(`/committees/${orgId}/committees/${committeeId}`),
    create: (orgId: string, data: any) =>
      this.client.post(`/committees/${orgId}/committees`, data),
    update: (orgId: string, committeeId: string, data: any) =>
      this.client.put(`/committees/${orgId}/committees/${committeeId}`, data),
    remove: (orgId: string, committeeId: string) =>
      this.client.delete(`/committees/${orgId}/committees/${committeeId}`),
    addMember: (orgId: string, committeeId: string, data: { userId: string }) =>
      this.client.post(`/committees/${orgId}/committees/${committeeId}/members`, data),
    removeMember: (orgId: string, committeeId: string, userId: string) =>
      this.client.delete(`/committees/${orgId}/committees/${committeeId}/members/${userId}`),
  };

  // ── Subscriptions & Wallets (SaaS) ────────────────────
  subscriptions = {
    getPlans: () => this.client.get('/subscriptions/plans'),
    getSubscription: (orgId: string) =>
      this.client.get(`/subscriptions/${orgId}/subscription`),
    subscribe: (orgId: string, data: { planSlug: string; billingCycle?: string; billingCountry?: string; paymentGateway?: string; paymentReference?: string }) =>
      this.client.post(`/subscriptions/${orgId}/subscribe`, data),
    renew: (orgId: string, data?: { paymentReference?: string; amountPaid?: number }) =>
      this.client.post(`/subscriptions/${orgId}/renew`, data || {}),
    getWallets: (orgId: string) =>
      this.client.get(`/subscriptions/${orgId}/wallets`),
    getAiWallet: (orgId: string) =>
      this.client.get(`/subscriptions/${orgId}/wallet/ai`),
    getTranslationWallet: (orgId: string) =>
      this.client.get(`/subscriptions/${orgId}/wallet/translation`),
    topUpAi: (orgId: string, data: { hours: number; paymentGateway?: string; paymentReference?: string }) =>
      this.client.post(`/subscriptions/${orgId}/wallet/ai/topup`, data),
    topUpTranslation: (orgId: string, data: { hours: number; paymentGateway?: string; paymentReference?: string }) =>
      this.client.post(`/subscriptions/${orgId}/wallet/translation/topup`, data),
    getAiHistory: (orgId: string, params?: any) =>
      this.client.get(`/subscriptions/${orgId}/wallet/ai/history`, { params }),
    getTranslationHistory: (orgId: string, params?: any) =>
      this.client.get(`/subscriptions/${orgId}/wallet/translation/history`, { params }),
    // Invite links
    createInvite: (orgId: string, data?: { role?: string; maxUses?: number; expiresAt?: string }) =>
      this.client.post(`/subscriptions/${orgId}/invite`, data || {}),
    getInvites: (orgId: string) =>
      this.client.get(`/subscriptions/${orgId}/invites`),
    deleteInvite: (orgId: string, inviteId: string) =>
      this.client.delete(`/subscriptions/${orgId}/invite/${inviteId}`),
    validateInvite: (code: string) =>
      this.client.get(`/subscriptions/invite/${code}`),
    joinViaInvite: (code: string) =>
      this.client.post(`/subscriptions/invite/${code}/join`),
    // Super admin
    adminRevenue: () => this.client.get('/subscriptions/admin/revenue'),
    adminSubscriptions: (params?: any) =>
      this.client.get('/subscriptions/admin/subscriptions', { params }),
    adminOrganizations: () => this.client.get('/subscriptions/admin/organizations'),
    adminGetOrganization: (orgId: string) => 
      this.client.get(`/subscriptions/admin/organizations/${orgId}`),
    adminUpdateOrganization: (orgId: string, data: any) =>
      this.client.put(`/subscriptions/admin/organizations/${orgId}`, data),
    adminDeleteOrganization: (orgId: string, confirm: boolean = false) =>
      this.client.delete(`/subscriptions/admin/organizations/${orgId}${confirm ? '?confirm=yes' : ''}`),
    adminCreateOrganization: (data: { name: string; slug: string; ownerEmail: string; plan?: string; currency?: string }) =>
      this.client.post('/subscriptions/admin/organizations', data),
    adminAssignPlan: (orgId: string, data: { planSlug: string; billingCycle?: string; currency?: string }) =>
      this.client.post(`/subscriptions/admin/organizations/${orgId}/assign-plan`, data),
    adminAdjustAiWallet: (data: { organizationId: string; hours: number; description: string }) =>
      this.client.post('/subscriptions/admin/wallet/ai/adjust', data),
    adminAdjustTranslationWallet: (data: { organizationId: string; hours: number; description: string }) =>
      this.client.post('/subscriptions/admin/wallet/translation/adjust', data),
    adminOrgStatus: (data: { organizationId: string; action: 'suspend' | 'activate'; reason?: string }) =>
      this.client.post('/subscriptions/admin/org/status', data),
    adminOverrideSubscription: (data: any) =>
      this.client.post('/subscriptions/admin/subscription/override', data),
    adminWalletAnalytics: () => this.client.get('/subscriptions/admin/wallet-analytics'),
    adminRiskLowBalances: (threshold?: number) =>
      this.client.get('/subscriptions/admin/risk/low-balances', { params: { threshold } }),
    adminRiskSpikes: (days?: number, multiplier?: number) =>
      this.client.get('/subscriptions/admin/risk/spikes', { params: { days, multiplier } }),
    // Plan management
    adminPlans: () => this.client.get('/subscriptions/admin/plans'),
    adminCreatePlan: (data: {
      name: string;
      slug: string;
      description?: string;
      maxMembers?: number;
      priceUsdAnnual?: number;
      priceUsdMonthly?: number;
      priceNgnAnnual?: number;
      priceNgnMonthly?: number;
      features?: Record<string, boolean>;
      sortOrder?: number;
      isActive?: boolean;
    }) => this.client.post('/subscriptions/admin/plans', data),
    adminUpdatePlan: (planId: string, data: any) =>
      this.client.put(`/subscriptions/admin/plans/${planId}`, data),
    adminDeletePlan: (planId: string) =>
      this.client.delete(`/subscriptions/admin/plans/${planId}`),
    // User management
    adminUsers: (params?: { page?: number; limit?: number; search?: string; globalRole?: string }) =>
      this.client.get('/subscriptions/admin/users', { params }),
    adminGetUser: (userId: string) =>
      this.client.get(`/subscriptions/admin/users/${userId}`),
    adminUpdateUser: (userId: string, data: { firstName?: string; lastName?: string; globalRole?: string; isVerified?: boolean }) =>
      this.client.put(`/subscriptions/admin/users/${userId}`, data),
    // Audit logs
    adminAuditLogs: (params?: { page?: number; limit?: number; orgId?: string; action?: string; entityType?: string }) =>
      this.client.get('/subscriptions/admin/audit-logs', { params }),
    // Signup invite management (super admin)
    adminSignupInvites: (params?: { page?: number; limit?: number; status?: string }) =>
      this.client.get('/subscriptions/admin/signup-invites', { params }),
    adminCreateSignupInvite: (data: { email?: string; role?: string; organizationId?: string; maxUses?: number; expiresInDays?: number; note?: string }) =>
      this.client.post('/subscriptions/admin/signup-invites', data),
    adminDeleteSignupInvite: (inviteId: string) =>
      this.client.delete(`/subscriptions/admin/signup-invites/${inviteId}`),
    validateSignupInvite: (code: string) =>
      this.client.get(`/subscriptions/invite/validate/${code}`),
  };

  // ── AI Credits (legacy — kept for backward compatibility) ─
  aiCredits = {
    get: (orgId: string) => this.client.get(`/payments/${orgId}/ai-credits`),
    purchase: (orgId: string, data: { credits: number }) =>
      this.client.post(`/payments/${orgId}/ai-credits/purchase`, data),
    grant: (data: { organizationId: string; credits: number; reason?: string }) =>
      this.client.post('/admin/ai-credits/grant', data),
  };

  // ── Notifications ─────────────────────────────────────
  notifications = {
    list: (params?: any) => this.client.get('/notifications', { params }),
    markRead: (id: string) => this.client.put(`/notifications/${id}/read`),
    markAllRead: (orgId?: string) =>
      this.client.put('/notifications/read-all', undefined, {
        params: orgId ? { orgId } : undefined,
      }),
    getPreferences: () => this.client.get('/notifications/preferences'),
    updatePreferences: (data: any) => this.client.put('/notifications/preferences', data),
  };

  // ── Announcements ─────────────────────────────────────
  announcements = {
    list: (orgId: string, params?: any) =>
      this.client.get(`/announcements/${orgId}`, { params }),
    get: (orgId: string, announcementId: string) =>
      this.client.get(`/announcements/${orgId}/${announcementId}`),
    create: (orgId: string, data: any) =>
      this.client.post(`/announcements/${orgId}`, data),
    update: (orgId: string, announcementId: string, data: any) =>
      this.client.put(`/announcements/${orgId}/${announcementId}`, data),
    delete: (orgId: string, announcementId: string) =>
      this.client.delete(`/announcements/${orgId}/${announcementId}`),
    togglePin: (orgId: string, announcementId: string) =>
      this.client.put(`/announcements/${orgId}/${announcementId}/pin`),
  };

  // ── Events ────────────────────────────────────────────
  events = {
    list: (orgId: string, params?: any) =>
      this.client.get(`/events/${orgId}`, { params }),
    get: (orgId: string, eventId: string) =>
      this.client.get(`/events/${orgId}/${eventId}`),
    create: (orgId: string, data: any) =>
      this.client.post(`/events/${orgId}`, data),
    update: (orgId: string, eventId: string, data: any) =>
      this.client.put(`/events/${orgId}/${eventId}`, data),
    delete: (orgId: string, eventId: string) =>
      this.client.delete(`/events/${orgId}/${eventId}`),
    rsvp: (orgId: string, eventId: string, data: { status: string }) =>
      this.client.post(`/events/${orgId}/${eventId}/rsvp`, data),
  };

  // ── Polls ─────────────────────────────────────────────
  polls = {
    list: (orgId: string, params?: any) =>
      this.client.get(`/polls/${orgId}`, { params }),
    get: (orgId: string, pollId: string) =>
      this.client.get(`/polls/${orgId}/${pollId}`),
    create: (orgId: string, data: any) =>
      this.client.post(`/polls/${orgId}`, data),
    update: (orgId: string, pollId: string, data: any) =>
      this.client.put(`/polls/${orgId}/${pollId}`, data),
    vote: (orgId: string, pollId: string, data: { optionId: string }) =>
      this.client.post(`/polls/${orgId}/${pollId}/vote`, data),
    close: (orgId: string, pollId: string) =>
      this.client.put(`/polls/${orgId}/${pollId}/close`),
    delete: (orgId: string, pollId: string) =>
      this.client.delete(`/polls/${orgId}/${pollId}`),
  };

  // ── Documents ─────────────────────────────────────────
  documents = {
    list: (orgId: string, params?: any) =>
      this.client.get(`/documents/${orgId}`, { params }),
    get: (orgId: string, docId: string) =>
      this.client.get(`/documents/${orgId}/${docId}`),
    upload: (orgId: string, formData: FormData) =>
      this.client.post(`/documents/${orgId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    delete: (orgId: string, docId: string) =>
      this.client.delete(`/documents/${orgId}/${docId}`),
    listFolders: (orgId: string) =>
      this.client.get(`/documents/${orgId}/folders`),
    createFolder: (orgId: string, data: { name: string; parentId?: string }) =>
      this.client.post(`/documents/${orgId}/folders`, data),
  };

  // ── Analytics ─────────────────────────────────────────
  analytics = {
    dashboard: (orgId: string) =>
      this.client.get(`/analytics/${orgId}/dashboard`),
    memberPayments: (orgId: string) =>
      this.client.get(`/analytics/${orgId}/member-payments`),
    receipt: (orgId: string, recordId: string) =>
      this.client.get(`/analytics/${orgId}/receipt/${recordId}`),
  };

  // ── Translation ───────────────────────────────────────
  translation = {
    getLanguages: () => this.client.get('/meetings/translation/languages'),
    translate: (text: string, targetLang: string, sourceLang?: string) =>
      this.client.post('/meetings/translation/translate', { text, targetLang, sourceLang }),
  };
}

export const api = new ApiClient();
