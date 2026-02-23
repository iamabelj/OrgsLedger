import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/models.dart';

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
      case 'meeting':
        return Icons.videocam;
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
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
                      subtitle: n.body != null
                          ? Text(
                              n.body!,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: AppTypography.caption,
                            )
                          : null,
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
                    ),
                  );
                },
              ),
            ),
    );
  }
}
