// ============================================================
// OrgsLedger Mobile — API Client
// ============================================================

import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import storage from '../utils/storage';

const API_BASE_URL = __DEV__
  ? 'http://localhost:3000/api'
  : 'https://test.orgsledger.com/api';

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

    // Response interceptor — handle token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
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
    register: (data: { email: string; password: string; firstName: string; lastName: string; phone?: string }) =>
      this.client.post('/auth/register', data),
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
    getSubscription: (orgId: string) =>
      this.client.get(`/organizations/${orgId}/subscription`),
    lookupBySlug: (slug: string) =>
      this.client.get(`/organizations/lookup/${slug}`),
    join: (orgId: string) =>
      this.client.post(`/organizations/${orgId}/join`),
  };

  // ── Chat ──────────────────────────────────────────────
  chat = {
    listChannels: (orgId: string) => this.client.get(`/chat/${orgId}/channels`),
    createChannel: (orgId: string, data: any) =>
      this.client.post(`/chat/${orgId}/channels`, data),
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
    uploadFiles: (orgId: string, channelId: string, files: { uri: string; name: string; mimeType: string }[]) => {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('files', {
          uri: file.uri,
          name: file.name,
          type: file.mimeType,
        } as any);
      });
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
    start: (orgId: string, meetingId: string) =>
      this.client.post(`/meetings/${orgId}/${meetingId}/start`),
    end: (orgId: string, meetingId: string) =>
      this.client.post(`/meetings/${orgId}/${meetingId}/end`),
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
        timeout: 120000, // 2 min for large audio files
      });
    },
  };

  // ── Financials ────────────────────────────────────────
  financials = {
    getDues: (orgId: string) => this.client.get(`/financials/${orgId}/dues`),
    createDue: (orgId: string, data: any) =>
      this.client.post(`/financials/${orgId}/dues`, data),
    getFines: (orgId: string) => this.client.get(`/financials/${orgId}/fines`),
    createFine: (orgId: string, data: any) =>
      this.client.post(`/financials/${orgId}/fines`, data),
    getCampaigns: (orgId: string) =>
      this.client.get(`/financials/${orgId}/donation-campaigns`),
    createCampaign: (orgId: string, data: any) =>
      this.client.post(`/financials/${orgId}/donation-campaigns`, data),
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

  // ── AI Credits ────────────────────────────────────────
  aiCredits = {
    get: (orgId: string) => this.client.get(`/payments/${orgId}/ai-credits`),
    purchase: (orgId: string, data: { credits: number }) =>
      this.client.post(`/payments/${orgId}/ai-credits/purchase`, data),
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
}

export const api = new ApiClient();
