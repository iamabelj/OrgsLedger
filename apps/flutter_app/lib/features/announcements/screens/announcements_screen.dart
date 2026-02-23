import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';

class AnnouncementsScreen extends ConsumerStatefulWidget {
  const AnnouncementsScreen({super.key});
  @override
  ConsumerState<AnnouncementsScreen> createState() =>
      _AnnouncementsScreenState();
}

class _AnnouncementsScreenState extends ConsumerState<AnnouncementsScreen> {
  List<Map<String, dynamic>> _announcements = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    try {
      final res = await api.getAnnouncements(orgId);
      final raw = res.data['data'] ?? res.data;
      if (mounted) {
        setState(() {
          _announcements = (raw is List)
              ? raw.whereType<Map<String, dynamic>>().toList()
              : [];
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showCreateOrEditDialog({Map<String, dynamic>? existing}) {
    final titleCtrl = TextEditingController(
      text: existing?['title']?.toString() ?? '',
    );
    final bodyCtrl = TextEditingController(
      text:
          existing?['body']?.toString() ??
          existing?['content']?.toString() ??
          existing?['message']?.toString() ??
          '',
    );

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(
          existing != null ? 'Edit Announcement' : 'New Announcement',
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: titleCtrl,
              decoration: const InputDecoration(labelText: 'Title'),
              style: const TextStyle(color: AppColors.textPrimary),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: bodyCtrl,
              decoration: const InputDecoration(labelText: 'Message'),
              style: const TextStyle(color: AppColors.textPrimary),
              maxLines: 4,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              final orgId = ref.read(authProvider).currentOrgId;
              if (orgId == null) return;
              try {
                if (existing != null) {
                  await api.updateAnnouncement(
                    orgId,
                    existing['id'].toString(),
                    {
                      'title': titleCtrl.text.trim(),
                      'body': bodyCtrl.text.trim(),
                    },
                  );
                } else {
                  await api.createAnnouncement(orgId, {
                    'title': titleCtrl.text.trim(),
                    'body': bodyCtrl.text.trim(),
                  });
                }
                if (ctx.mounted) Navigator.pop(ctx);
                _load();
              } catch (e) {
                if (ctx.mounted) {
                  ScaffoldMessenger.of(ctx).showSnackBar(
                    SnackBar(
                      content: Text('Failed: $e'),
                      backgroundColor: AppColors.error,
                    ),
                  );
                }
              }
            },
            child: Text(existing != null ? 'Update' : 'Post'),
          ),
        ],
      ),
    );
  }

  Future<void> _deleteAnnouncement(String id) async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Announcement'),
        content: const Text('Are you sure?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await api.deleteAnnouncement(orgId, id);
      _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to delete'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final width = MediaQuery.of(context).size.width;
    final isDesktop = width >= 1024;

    return Scaffold(
      appBar: AppBar(
        leading: isDesktop
            ? null
            : IconButton(
                icon: const Icon(Icons.menu, color: AppColors.highlight),
                onPressed: () => AppShell.openDrawer(),
              ),
        title: const Text('Announcements'),
      ),
      floatingActionButton: auth.isAdmin
          ? FloatingActionButton(
              onPressed: () => _showCreateOrEditDialog(),
              backgroundColor: AppColors.highlight,
              child: const Icon(Icons.add, color: AppColors.background),
            )
          : null,
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.highlight),
            )
          : _announcements.isEmpty
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.campaign_outlined,
                    size: 56,
                    color: AppColors.textLight,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text('No announcements yet', style: AppTypography.bodySmall),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              color: AppColors.highlight,
              child: ListView.builder(
                padding: const EdgeInsets.all(AppSpacing.md),
                itemCount: _announcements.length,
                itemBuilder: (_, i) => _AnnouncementCard(
                  data: _announcements[i],
                  isAdmin: auth.isAdmin,
                  onEdit: () =>
                      _showCreateOrEditDialog(existing: _announcements[i]),
                  onDelete: () =>
                      _deleteAnnouncement(_announcements[i]['id'].toString()),
                ),
              ),
            ),
    );
  }
}

class _AnnouncementCard extends StatelessWidget {
  final Map<String, dynamic> data;
  final bool isAdmin;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _AnnouncementCard({
    required this.data,
    required this.isAdmin,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final title = data['title']?.toString() ?? 'Announcement';
    final body = data['body'] ?? data['content'] ?? data['message'] ?? '';
    final author =
        data['authorName'] ?? data['author_name'] ?? data['createdBy'] ?? '';
    final createdAt = data['createdAt'] ?? data['created_at'] ?? '';
    String dateStr = '';
    if (createdAt.toString().isNotEmpty) {
      try {
        final d = DateTime.parse(createdAt.toString()).toLocal();
        dateStr = '${d.month}/${d.day}/${d.year}';
      } catch (_) {}
    }

    return Card(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.campaign_rounded,
                  color: AppColors.highlight,
                  size: 20,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    title,
                    style: AppTypography.body.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                if (isAdmin)
                  PopupMenuButton<String>(
                    icon: const Icon(
                      Icons.more_vert,
                      color: AppColors.textSecondary,
                      size: 20,
                    ),
                    onSelected: (v) {
                      if (v == 'edit') onEdit();
                      if (v == 'delete') onDelete();
                    },
                    itemBuilder: (_) => [
                      const PopupMenuItem(value: 'edit', child: Text('Edit')),
                      const PopupMenuItem(
                        value: 'delete',
                        child: Text('Delete'),
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(body.toString(), style: AppTypography.bodySmall),
            if (author.toString().isNotEmpty || dateStr.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                [
                  if (author.toString().isNotEmpty) author,
                  if (dateStr.isNotEmpty) dateStr,
                ].join(' · '),
                style: AppTypography.caption,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
