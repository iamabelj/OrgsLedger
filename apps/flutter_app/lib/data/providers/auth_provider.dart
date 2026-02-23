import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/api/api_client.dart';
import '../../data/models/models.dart';
import '../../data/socket/socket_client.dart';

/// Auth state — loading / authenticated / unauthenticated.
class AuthState {
  final bool isLoading;
  final bool isAuthenticated;
  final User? user;
  final String? currentOrgId;
  final String? error;

  const AuthState({
    this.isLoading = true,
    this.isAuthenticated = false,
    this.user,
    this.currentOrgId,
    this.error,
  });

  Membership? get currentMembership {
    if (currentOrgId == null || user == null) return null;
    return user!.memberships.cast<Membership?>().firstWhere(
      (m) => m?.organizationId == currentOrgId,
      orElse: () => null,
    );
  }

  bool get isAdmin => currentMembership?.isAdmin ?? false;

  AuthState copyWith({
    bool? isLoading,
    bool? isAuthenticated,
    User? user,
    String? currentOrgId,
    String? error,
  }) => AuthState(
    isLoading: isLoading ?? this.isLoading,
    isAuthenticated: isAuthenticated ?? this.isAuthenticated,
    user: user ?? this.user,
    currentOrgId: currentOrgId ?? this.currentOrgId,
    error: error,
  );
}

class AuthNotifier extends Notifier<AuthState> {
  @override
  AuthState build() {
    Future.microtask(() => _init());
    return const AuthState();
  }

  Future<void> _init() async {
    try {
      final token = await api.accessToken;
      if (token != null) {
        // Timeout the entire auth check so the app never hangs on a slow server.
        await loadUser().timeout(
          const Duration(seconds: 5),
          onTimeout: () {
            state = const AuthState(isLoading: false);
          },
        );
      } else {
        state = const AuthState(isLoading: false);
      }
    } catch (_) {
      state = const AuthState(isLoading: false);
    }
  }

  Future<bool> login(String email, String password) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final res = await api.login(email, password);
      final data = res.data['data'] ?? res.data;
      await api.setTokens(data['accessToken'], data['refreshToken']);
      await loadUser();
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<bool> register(Map<String, dynamic> data) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final res = await api.register(data);
      final d = res.data['data'] ?? res.data;
      if (d['accessToken'] != null) {
        await api.setTokens(d['accessToken'], d['refreshToken']);
        await loadUser();
      }
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<bool> adminRegister(Map<String, dynamic> data) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final res = await api.adminRegister(data);
      final d = res.data['data'] ?? res.data;
      if (d['accessToken'] != null) {
        await api.setTokens(d['accessToken'], d['refreshToken']);
        await loadUser();
      }
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<void> loadUser() async {
    try {
      final res = await api.getMe();
      final data = res.data['data'] ?? res.data;
      final user = User.fromJson(data);
      String? orgId = state.currentOrgId;
      if (orgId == null && user.memberships.isNotEmpty) {
        orgId = user.memberships.first.organizationId;
      }
      state = AuthState(
        isLoading: false,
        isAuthenticated: true,
        user: user,
        currentOrgId: orgId,
      );
      // Connect socket
      await socketClient.connect();
      if (orgId != null) socketClient.joinOrg(orgId);
    } catch (_) {
      state = const AuthState(isLoading: false);
    }
  }

  void switchOrg(String orgId) {
    if (state.currentOrgId != null) {
      socketClient.leaveOrg(state.currentOrgId!);
    }
    state = state.copyWith(currentOrgId: orgId);
    socketClient.joinOrg(orgId);
  }

  Future<void> logout() async {
    socketClient.disconnect();
    await api.clearTokens();
    state = const AuthState(isLoading: false);
  }

  /// Force the state to unauthenticated — used by splash timeout so the
  /// router can redirect to login instead of staying stuck.
  void forceUnauthenticated() {
    if (state.isLoading) {
      state = const AuthState(isLoading: false);
    }
  }

  String _extractError(dynamic e) {
    if (e is Exception) {
      try {
        final dio = e as dynamic;
        return dio.response?.data?['error']?.toString() ??
            dio.response?.data?['details']?[0]?['message']?.toString() ??
            e.toString();
      } catch (_) {}
    }
    return e.toString();
  }
}

final authProvider = NotifierProvider<AuthNotifier, AuthState>(() {
  return AuthNotifier();
});
