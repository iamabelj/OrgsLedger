import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'core/theme/app_theme.dart';
import 'core/services/notification_service.dart';
import 'data/providers/auth_provider.dart';
import 'data/socket/socket_client.dart';
import 'routing/app_router.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Non-blocking: never let notification init prevent app from starting
  try {
    await notificationService.initialize().timeout(
      const Duration(seconds: 3),
      onTimeout: () {},
    );
  } catch (_) {
    // Swallow — notifications are optional.
  }
  runApp(const ProviderScope(child: OrgsLedgerApp()));
}

class OrgsLedgerApp extends ConsumerStatefulWidget {
  const OrgsLedgerApp({super.key});

  @override
  ConsumerState<OrgsLedgerApp> createState() => _OrgsLedgerAppState();
}

class _OrgsLedgerAppState extends ConsumerState<OrgsLedgerApp> {
  GoRouter? _router;
  bool _socketListenersAttached = false;

  @override
  void initState() {
    super.initState();

    // Set up notification tap handler
    notificationService.onNotificationTap = (payload) {
      if (payload != null) {
        _router?.push(payload);
      }
    };
  }

  void _attachSocketNotificationListeners() {
    if (_socketListenersAttached) return;
    _socketListenersAttached = true;

    // New chat message (background)
    socketClient.on('chat:message', (data) {
      if (data is Map<String, dynamic>) {
        notificationService.showChatNotification(
          senderName: data['userName']?.toString() ?? 'New message',
          message: data['content']?.toString() ?? '',
          channelId: data['channelId']?.toString(),
        );
      }
    });

    // Generic notification from server
    socketClient.on('notification', (data) {
      if (data is Map<String, dynamic>) {
        notificationService.showGenericNotification(
          title: data['title']?.toString() ?? 'OrgsLedger',
          body: data['body']?.toString(),
          route: data['route']?.toString(),
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);

    // Connect socket when authenticated
    if (auth.isAuthenticated) {
      socketClient.connect();
      _attachSocketNotificationListeners();
    }

    // Build router once, rebuild only when auth state fundamentally changes
    _router ??= buildRouter(ref);

    return MaterialApp.router(
      title: 'OrgsLedger',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      routerConfig: _router!,
    );
  }
}
