import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../core/constants/app_constants.dart';

/// Centralised Dio-based HTTP client that mirrors the Expo API client.
class ApiClient {
  static final ApiClient _instance = ApiClient._();
  factory ApiClient() => _instance;

  late final Dio dio;
  final _storage = const FlutterSecureStorage();

  ApiClient._() {
    dio = Dio(
      BaseOptions(
        baseUrl: kApiBaseUrl,
        connectTimeout: const Duration(seconds: 30),
        receiveTimeout: const Duration(seconds: 30),
        headers: {'Content-Type': 'application/json'},
      ),
    );

    // ── Attach auth token ───────────────────────────
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _storage.read(key: 'accessToken');
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          // ── 401 → refresh token ──
          if (error.response?.statusCode == 401) {
            final refreshToken = await _storage.read(key: 'refreshToken');
            if (refreshToken != null) {
              try {
                final res = await Dio().post(
                  '$kApiBaseUrl/auth/refresh',
                  data: {'refreshToken': refreshToken},
                );
                final data = res.data['data'];
                await _storage.write(
                  key: 'accessToken',
                  value: data['accessToken'],
                );
                await _storage.write(
                  key: 'refreshToken',
                  value: data['refreshToken'],
                );
                error.requestOptions.headers['Authorization'] =
                    'Bearer ${data['accessToken']}';
                final retry = await dio.fetch(error.requestOptions);
                return handler.resolve(retry);
              } catch (_) {
                // Refresh failed — let original 401 propagate
              }
            }
          }
          // ── 503 → retry (server booting) ──
          if (error.response?.statusCode == 503) {
            final retryCount =
                (error.requestOptions.extra['_retryCount'] as int?) ?? 0;
            if (retryCount < 3) {
              await Future.delayed(
                Duration(milliseconds: 1500 * (retryCount + 1)),
              );
              error.requestOptions.extra['_retryCount'] = retryCount + 1;
              final retry = await dio.fetch(error.requestOptions);
              return handler.resolve(retry);
            }
          }
          handler.next(error);
        },
      ),
    );
  }

  // ── Convenience setters for login/logout ──
  Future<void> setTokens(String access, String refresh) async {
    await _storage.write(key: 'accessToken', value: access);
    await _storage.write(key: 'refreshToken', value: refresh);
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: 'accessToken');
    await _storage.delete(key: 'refreshToken');
  }

  Future<String?> get accessToken => _storage.read(key: 'accessToken');

  // ═══════════════════════════════════════════════════════
  //  AUTH
  // ═══════════════════════════════════════════════════════
  Future<Response> login(String email, String password) =>
      dio.post('/auth/login', data: {'email': email, 'password': password});

  Future<Response> register(Map<String, dynamic> data) =>
      dio.post('/auth/register', data: data);

  Future<Response> adminRegister(Map<String, dynamic> data) =>
      dio.post('/auth/admin-register', data: data);

  Future<Response> getMe() => dio.get('/auth/me');

  Future<Response> updateProfile(Map<String, dynamic> data) =>
      dio.put('/auth/me', data: data);

  Future<Response> forgotPassword(String email) =>
      dio.post('/auth/forgot-password', data: {'email': email});

  Future<Response> resetPassword(String email, String code, String password) =>
      dio.post(
        '/auth/reset-password',
        data: {'email': email, 'code': code, 'newPassword': password},
      );

  Future<Response> sendVerification() => dio.post('/auth/send-verification');

  Future<Response> verifyEmail(String code) =>
      dio.post('/auth/verify-email', data: {'code': code});

  Future<Response> changePassword(String current, String newPw) => dio.put(
    '/auth/change-password',
    data: {'currentPassword': current, 'newPassword': newPw},
  );

  Future<Response> uploadAvatar(String filePath) async {
    final formData = FormData.fromMap({
      'avatar': await MultipartFile.fromFile(filePath),
    });
    return dio.post('/auth/upload-avatar', data: formData);
  }

  // ═══════════════════════════════════════════════════════
  //  ORGANIZATIONS
  // ═══════════════════════════════════════════════════════
  Future<Response> getOrganizations() => dio.get('/organizations');

  Future<Response> getOrganization(String orgId) =>
      dio.get('/organizations/$orgId');

  Future<Response> createOrganization(Map<String, dynamic> data) =>
      dio.post('/organizations', data: data);

  Future<Response> updateOrgSettings(String orgId, Map<String, dynamic> data) =>
      dio.put('/organizations/$orgId/settings', data: data);

  Future<Response> getMembers(String orgId) =>
      dio.get('/organizations/$orgId/members');

  Future<Response> getMemberDetail(String orgId, String userId) =>
      dio.get('/organizations/$orgId/members/$userId');

  Future<Response> updateMemberRole(
    String orgId,
    String userId,
    Map<String, dynamic> data,
  ) => dio.put('/organizations/$orgId/members/$userId', data: data);

  Future<Response> removeMember(String orgId, String userId) =>
      dio.delete('/organizations/$orgId/members/$userId');

  Future<Response> lookupOrgBySlug(String slug) =>
      dio.get('/organizations/lookup/$slug');

  Future<Response> joinOrg(String orgId, {String? inviteCode}) => dio.post(
    '/organizations/$orgId/join',
    data: inviteCode != null ? {'inviteCode': inviteCode} : null,
  );

  Future<Response> getAuditLogs(String orgId) =>
      dio.get('/organizations/$orgId/audit-logs');

  // ═══════════════════════════════════════════════════════
  //  CHAT
  // ═══════════════════════════════════════════════════════
  Future<Response> getChannels(String orgId) =>
      dio.get('/chat/$orgId/channels');

  Future<Response> createChannel(String orgId, Map<String, dynamic> data) =>
      dio.post('/chat/$orgId/channels', data: data);

  Future<Response> getMessages(String orgId, String channelId, {int? before}) =>
      dio.get(
        '/chat/$orgId/channels/$channelId/messages',
        queryParameters: before != null ? {'before': before} : null,
      );

  Future<Response> sendMessage(
    String orgId,
    String channelId,
    Map<String, dynamic> data,
  ) => dio.post('/chat/$orgId/channels/$channelId/messages', data: data);

  Future<Response> markChannelRead(String orgId, String channelId) =>
      dio.post('/chat/$orgId/channels/$channelId/mark-read');

  Future<Response> getOrCreateDm(String orgId, String targetUserId) =>
      dio.post('/chat/$orgId/dm/$targetUserId');

  // ═══════════════════════════════════════════════════════
  //  FINANCIALS
  // ═══════════════════════════════════════════════════════
  Future<Response> getDues(String orgId) => dio.get('/financials/$orgId/dues');

  Future<Response> createDue(String orgId, Map<String, dynamic> data) =>
      dio.post('/financials/$orgId/dues', data: data);

  Future<Response> getFines(String orgId) =>
      dio.get('/financials/$orgId/fines');

  Future<Response> createFine(String orgId, Map<String, dynamic> data) =>
      dio.post('/financials/$orgId/fines', data: data);

  Future<Response> getDonationCampaigns(String orgId) =>
      dio.get('/financials/$orgId/donation-campaigns');

  Future<Response> createDonation(String orgId, Map<String, dynamic> data) =>
      dio.post('/financials/$orgId/donation-campaigns', data: data);

  Future<Response> getLedger(String orgId) =>
      dio.get('/financials/$orgId/ledger');

  Future<Response> getUserPaymentHistory(String orgId, String userId) =>
      dio.get('/financials/$orgId/ledger/user/$userId');

  // ═══════════════════════════════════════════════════════
  //  PAYMENTS
  // ═══════════════════════════════════════════════════════
  Future<Response> makePayment(String orgId, Map<String, dynamic> data) =>
      dio.post('/payments/$orgId/payments/pay', data: data);

  Future<Response> getPaymentGateways(String orgId) =>
      dio.get('/payments/$orgId/payments/gateways');

  Future<Response> getPendingTransfers(String orgId) =>
      dio.get('/payments/$orgId/payments/pending-transfers');

  Future<Response> approveTransfer(String orgId, Map<String, dynamic> data) =>
      dio.post('/payments/$orgId/payments/approve-transfer', data: data);

  // ═══════════════════════════════════════════════════════
  //  POLLS
  // ═══════════════════════════════════════════════════════
  Future<Response> getPolls(String orgId) => dio.get('/polls/$orgId');

  Future<Response> createPoll(String orgId, Map<String, dynamic> data) =>
      dio.post('/polls/$orgId', data: data);

  Future<Response> votePoll(
    String orgId,
    String pollId,
    Map<String, dynamic> data,
  ) => dio.post('/polls/$orgId/$pollId/vote', data: data);

  Future<Response> closePoll(String orgId, String pollId) =>
      dio.post('/polls/$orgId/$pollId/close');

  Future<Response> updatePoll(
    String orgId,
    String pollId,
    Map<String, dynamic> data,
  ) => dio.put('/polls/$orgId/$pollId', data: data);

  // ═══════════════════════════════════════════════════════
  //  DOCUMENTS
  // ═══════════════════════════════════════════════════════
  Future<Response> getDocuments(String orgId, {String? folderId}) => dio.get(
    '/documents/$orgId',
    queryParameters: folderId != null ? {'folderId': folderId} : null,
  );

  Future<Response> uploadDocument(
    String orgId,
    String filePath, {
    String? folderId,
  }) async {
    final formData = FormData.fromMap({
      'file': await MultipartFile.fromFile(filePath),
      'folderId': ?folderId,
    });
    return dio.post('/documents/$orgId', data: formData);
  }

  Future<Response> deleteDocument(String orgId, String docId) =>
      dio.delete('/documents/$orgId/$docId');

  // ═══════════════════════════════════════════════════════
  //  EVENTS
  // ═══════════════════════════════════════════════════════
  Future<Response> getEvents(String orgId) => dio.get('/events/$orgId');

  Future<Response> createEvent(String orgId, Map<String, dynamic> data) =>
      dio.post('/events/$orgId', data: data);

  Future<Response> updateEvent(
    String orgId,
    String eventId,
    Map<String, dynamic> data,
  ) => dio.put('/events/$orgId/$eventId', data: data);

  Future<Response> deleteEvent(String orgId, String eventId) =>
      dio.delete('/events/$orgId/$eventId');

  Future<Response> rsvpEvent(
    String orgId,
    String eventId,
    Map<String, dynamic> data,
  ) => dio.post('/events/$orgId/$eventId/rsvp', data: data);

  // ═══════════════════════════════════════════════════════
  //  ANNOUNCEMENTS
  // ═══════════════════════════════════════════════════════
  Future<Response> getAnnouncements(String orgId) =>
      dio.get('/announcements/$orgId');

  Future<Response> createAnnouncement(
    String orgId,
    Map<String, dynamic> data,
  ) => dio.post('/announcements/$orgId', data: data);

  Future<Response> updateAnnouncement(
    String orgId,
    String announcementId,
    Map<String, dynamic> data,
  ) => dio.put('/announcements/$orgId/$announcementId', data: data);

  Future<Response> deleteAnnouncement(String orgId, String announcementId) =>
      dio.delete('/announcements/$orgId/$announcementId');

  // ═══════════════════════════════════════════════════════
  //  NOTIFICATIONS
  // ═══════════════════════════════════════════════════════
  Future<Response> getNotifications() => dio.get('/notifications');

  Future<Response> markNotificationRead(String id) =>
      dio.put('/notifications/$id/read');

  Future<Response> markAllNotificationsRead() =>
      dio.put('/notifications/read-all');

  // ═══════════════════════════════════════════════════════
  //  COMMITTEES
  // ═══════════════════════════════════════════════════════
  Future<Response> getCommittees(String orgId) =>
      dio.get('/committees/$orgId/committees');

  Future<Response> createCommittee(String orgId, Map<String, dynamic> data) =>
      dio.post('/committees/$orgId/committees', data: data);

  // ═══════════════════════════════════════════════════════
  //  SUBSCRIPTIONS & WALLETS
  // ═══════════════════════════════════════════════════════
  Future<Response> getPlans() => dio.get('/subscriptions/plans');

  Future<Response> getSubscription(String orgId) =>
      dio.get('/subscriptions/$orgId/subscription');

  Future<Response> subscribe(String orgId, Map<String, dynamic> data) =>
      dio.post('/subscriptions/$orgId/subscribe', data: data);

  Future<Response> getWallets(String orgId) =>
      dio.get('/subscriptions/$orgId/wallets');

  Future<Response> getAiWallet(String orgId) =>
      dio.get('/subscriptions/$orgId/wallet/ai');

  Future<Response> topUpAiWallet(String orgId, Map<String, dynamic> data) =>
      dio.post('/subscriptions/$orgId/wallet/ai/topup', data: data);

  // ═══════════════════════════════════════════════════════
  //  INVITES
  // ═══════════════════════════════════════════════════════
  Future<Response> getInvites(String orgId) =>
      dio.get('/subscriptions/$orgId/invites');

  Future<Response> createInvite(String orgId, Map<String, dynamic> data) =>
      dio.post('/subscriptions/$orgId/invite', data: data);

  Future<Response> validateInvite(String code) =>
      dio.get('/subscriptions/invite/$code');

  Future<Response> joinViaInvite(String code) =>
      dio.post('/subscriptions/invite/$code/join');

  // ═══════════════════════════════════════════════════════
  //  ANALYTICS
  // ═══════════════════════════════════════════════════════
  Future<Response> getAnalytics(String orgId) => dio.get('/analytics/$orgId');
}

/// Global singleton
final api = ApiClient();
