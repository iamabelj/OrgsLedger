import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/models.dart';
import '../../../core/widgets/app_shell.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});
  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  List<AppNotification> _notifications = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadNotifications();
  }

  Future<void> _loadNotifications() async {
    try {
      final res = await api.getNotifications();
      final data = (res.data['data'] ?? res.data) as List? ?? [];
      if (mounted) {
        setState(() {
          _notifications = data
              .map((n) => AppNotification.fromJson(n))
              .toList();
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _markAllRead() async {
    try {
      await api.markAllNotificationsRead();
      _loadNotifications();
    } catch (_) {}
  }

  IconData _iconForType(String? type) {
    switch (type) {
      case 'chat':
        return Icons.chat;
      case 'payment':
      case 'financial':
        return Icons.payment;
      case 'poll':
        return Icons.poll;
      case 'event':
        return Icons.event;
      case 'member':
        return Icons.person_add;
      default:
        return Icons.notifications;
    }
  }

  void _onNotificationTap(AppNotification n) async {
    // Mark as read
    if (!n.isRead) {
      try {
        await api.markNotificationRead(n.id);
      } catch (_) {}
    }

    if (!mounted) return;

    // Navigate based on type
    final data = n.data;
    switch (n.type) {
      case 'chat':
        final channelId =
            data?['channelId']?.toString() ?? data?['channel_id']?.toString();
        if (channelId != null) {
          context.push('/chat/$channelId');
        } else {
          context.push('/chat');
        }
        break;
      case 'poll':
        context.push('/polls');
        break;
      case 'event':
        context.push('/events');
        break;
      case 'payment':
      case 'financial':
        context.push('/financials');
        break;
      case 'member':
        context.push('/members');
        break;
      case 'announcement':
        context.push('/announcements');
        break;
      default:
        break;
    }

    _loadNotifications();
  }

  String _formatTimestamp(String createdAt) {
    final dt = DateTime.tryParse(createdAt);
    if (dt == null) return '';
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${dt.day}/${dt.month}/${dt.year}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: MediaQuery.of(context).size.width < 1024
            ? IconButton(
                icon: const Icon(Icons.menu, color: AppColors.highlight),
                onPressed: () => AppShell.openDrawer(),
              )
            : null,
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: _markAllRead,
            child: const Text(
              'Mark all read',
              style: TextStyle(color: AppColors.highlight),
            ),
          ),
        ],
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.highlight),
            )
          : _notifications.isEmpty
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.notifications_none,
                    size: 64,
                    color: AppColors.textLight,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text('No notifications', style: AppTypography.bodySmall),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _loadNotifications,
              child: ListView.builder(
                itemCount: _notifications.length,
                itemBuilder: (_, i) {
                  final n = _notifications[i];
                  return Container(
                    color: n.isRead
                        ? Colors.transparent
                        : AppColors.highlight.withValues(alpha: 0.03),
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: n.isRead
                            ? AppColors.surfaceAlt
                            : AppColors.highlightSubtle,
                        child: Icon(
                          _iconForType(n.type),
                          color: n.isRead
                              ? AppColors.textLight
                              : AppColors.highlight,
                          size: 20,
                        ),
                      ),
                      title: Text(
                        n.title,
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontWeight: n.isRead
                              ? FontWeight.w400
                              : FontWeight.w600,
                        ),
                      ),
                      subtitle: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (n.body != null)
                            Text(
                              n.body!,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: AppTypography.caption,
                            ),
                          if (n.createdAt.isNotEmpty) ...[
                            const SizedBox(height: 2),
                            Text(
                              _formatTimestamp(n.createdAt),
                              style: AppTypography.caption.copyWith(
                                color: AppColors.textSecondary,
                                fontSize: 10,
                              ),
                            ),
                          ],
                        ],
                      ),
                      trailing: !n.isRead
                          ? Container(
                              width: 8,
                              height: 8,
                              decoration: const BoxDecoration(
                                color: AppColors.highlight,
                                shape: BoxShape.circle,
                              ),
                            )
                          : null,
                      onTap: () => _onNotificationTap(n),
                    ),
                  );
                },
              ),
            ),
    );
  }
}
