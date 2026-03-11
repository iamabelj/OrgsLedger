import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../data/providers/auth_provider.dart';
import '../features/auth/screens/login_screen.dart';
import '../features/auth/screens/register_screen.dart';
import '../features/auth/screens/admin_register_screen.dart';
import '../features/auth/screens/forgot_password_screen.dart';
import '../features/home/screens/home_screen.dart';
import '../features/chat/screens/chat_list_screen.dart';
import '../features/chat/screens/chat_conversation_screen.dart';
import '../features/financials/screens/financials_screen.dart';
import '../features/members/screens/members_screen.dart';
import '../features/polls/screens/polls_screen.dart';
import '../features/documents/screens/documents_screen.dart';
import '../features/events/screens/events_screen.dart';
import '../features/notifications/screens/notifications_screen.dart';
import '../features/settings/screens/profile_screen.dart';
import '../features/admin/screens/admin_hub_screen.dart';
import '../features/admin/screens/org_settings_screen.dart';
import '../features/legal/screens/legal_screen.dart';
import '../features/organizations/screens/create_org_screen.dart';
import '../features/announcements/screens/announcements_screen.dart';
import '../features/help/screens/help_screen.dart';
import '../core/widgets/app_shell.dart';
import '../core/theme/app_colors.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>();
final _shellNavigatorKey = GlobalKey<NavigatorState>();

/// ValueNotifier that GoRouter listens to — bumps value on every auth change.
final _authChangeNotifier = ValueNotifier<int>(0);

GoRouter buildRouter(WidgetRef ref) {
  // Listen to auth changes and bump the notifier so the router re-evaluates.
  ref.listenManual<AuthState>(authProvider, (_, _) {
    _authChangeNotifier.value++;
  });

  final refreshListenable = _authChangeNotifier;

  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/',
    refreshListenable: refreshListenable,
    redirect: (context, state) {
      final auth = ref.read(authProvider);

      // Show loading/splash while checking auth
      if (auth.isLoading) {
        final isSplash = state.matchedLocation == '/splash';
        return isSplash ? null : '/splash';
      }

      final isAuth = auth.isAuthenticated;
      final isAuthRoute = state.matchedLocation.startsWith('/auth');
      final isSplash = state.matchedLocation == '/splash';
      final isCreateOrg = state.matchedLocation == '/create-org';

      // Not authenticated → go to login (unless already on auth route)
      if (!isAuth && !isAuthRoute) return '/auth/login';

      // Authenticated but no memberships → go to create/join org
      if (isAuth && auth.user != null && auth.user!.memberships.isEmpty) {
        if (!isCreateOrg) return '/create-org';
        return null;
      }

      // Authenticated → redirect away from auth/splash routes
      if (isAuth && (isAuthRoute || isSplash)) return '/';
      return null;
    },
    routes: [
      // ── Splash / Loading Screen ─────────────────────
      GoRoute(path: '/splash', builder: (_, _) => const _SplashScreen()),

      // ── Auth Routes ─────────────────────────────────
      GoRoute(path: '/auth/login', builder: (_, _) => const LoginScreen()),
      GoRoute(
        path: '/auth/register',
        builder: (_, _) => const RegisterScreen(),
      ),
      GoRoute(
        path: '/auth/admin-register',
        builder: (_, _) => const AdminRegisterScreen(),
      ),
      GoRoute(
        path: '/auth/forgot-password',
        builder: (_, _) => const ForgotPasswordScreen(),
      ),

      // ── App Shell (tabs + drawer) ───────────────────
      ShellRoute(
        navigatorKey: _shellNavigatorKey,
        builder: (_, _, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/',
            pageBuilder: (_, _) => const NoTransitionPage(child: HomeScreen()),
          ),
          GoRoute(
            path: '/chat',
            pageBuilder: (_, _) =>
                const NoTransitionPage(child: ChatListScreen()),
          ),
          GoRoute(
            path: '/chat/:channelId',
            builder: (_, state) => ChatConversationScreen(
              channelId: state.pathParameters['channelId']!,
            ),
          ),
          GoRoute(
            path: '/financials',
            pageBuilder: (_, _) =>
                const NoTransitionPage(child: FinancialsScreen()),
          ),
          GoRoute(
            path: '/profile',
            pageBuilder: (_, _) =>
                const NoTransitionPage(child: ProfileScreen()),
          ),
          GoRoute(path: '/members', builder: (_, _) => const MembersScreen()),
          GoRoute(path: '/polls', builder: (_, _) => const PollsScreen()),
          GoRoute(
            path: '/documents',
            builder: (_, _) => const DocumentsScreen(),
          ),
          GoRoute(path: '/events', builder: (_, _) => const EventsScreen()),
          GoRoute(
            path: '/notifications',
            builder: (_, _) => const NotificationsScreen(),
          ),
          GoRoute(path: '/admin', builder: (_, _) => const AdminHubScreen()),
          GoRoute(
            path: '/org-settings',
            builder: (_, _) => const OrgSettingsScreen(),
          ),
          GoRoute(
            path: '/create-org',
            builder: (_, _) => const CreateOrgScreen(),
          ),
          GoRoute(
            path: '/announcements',
            builder: (_, _) => const AnnouncementsScreen(),
          ),
          GoRoute(path: '/help', builder: (_, _) => const HelpScreen()),
          GoRoute(path: '/legal', builder: (_, _) => const LegalScreen()),
        ],
      ),
    ],
  );
}

/// Simple splash screen — shown briefly while auth initializes.
class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(20),
              child: Image.asset(
                'assets/logo.png',
                width: 100,
                height: 100,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    color: AppColors.highlightSubtle,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Icon(
                    Icons.account_balance_rounded,
                    color: AppColors.highlight,
                    size: 52,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'OrgsLedger',
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w700,
                color: AppColors.highlight,
                letterSpacing: -0.5,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Organization Management Platform',
              style: TextStyle(
                fontSize: 13,
                color: AppColors.textSecondary,
                letterSpacing: 0.2,
              ),
            ),
            const SizedBox(height: 36),
            const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                color: AppColors.highlight,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
