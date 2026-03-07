import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/models.dart';
import '../../../core/widgets/app_shell.dart';

class EventsScreen extends ConsumerStatefulWidget {
  const EventsScreen({super.key});
  @override
  ConsumerState<EventsScreen> createState() => _EventsScreenState();
}

class _EventsScreenState extends ConsumerState<EventsScreen> {
  List<AppEvent> _events = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadEvents();
  }

  Future<void> _loadEvents() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) {
      setState(() => _loading = false);
      return;
    }
    try {
      final res = await api.getEvents(orgId);
      final data = (res.data['data'] ?? res.data) as List? ?? [];
      if (mounted) {
        setState(() {
          _events = data.map((e) => AppEvent.fromJson(e)).toList();
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showCreateOrEditDialog({AppEvent? existing}) {
    final titleCtrl = TextEditingController(text: existing?.title ?? '');
    final descCtrl = TextEditingController(text: existing?.description ?? '');
    final locationCtrl = TextEditingController(text: existing?.location ?? '');
    DateTime startDate = existing != null
        ? (DateTime.tryParse(existing.startDate) ??
              DateTime.now().add(const Duration(days: 1)))
        : DateTime.now().add(const Duration(days: 1));
    TimeOfDay startTime = existing != null
        ? TimeOfDay.fromDateTime(
            DateTime.tryParse(existing.startDate) ?? DateTime.now(),
          )
        : const TimeOfDay(hour: 10, minute: 0);
    String category = 'general';

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text(existing != null ? 'Edit Event' : 'New Event'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: titleCtrl,
                  decoration: const InputDecoration(labelText: 'Title *'),
                  style: const TextStyle(color: AppColors.textPrimary),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: descCtrl,
                  decoration: const InputDecoration(labelText: 'Description'),
                  style: const TextStyle(color: AppColors.textPrimary),
                  maxLines: 3,
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: locationCtrl,
                  decoration: const InputDecoration(labelText: 'Location'),
                  style: const TextStyle(color: AppColors.textPrimary),
                ),
                const SizedBox(height: AppSpacing.sm),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    'Date: ${startDate.month}/${startDate.day}/${startDate.year}',
                    style: AppTypography.body,
                  ),
                  trailing: const Icon(
                    Icons.calendar_today,
                    color: AppColors.textSecondary,
                  ),
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: ctx,
                      initialDate: startDate,
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 730)),
                    );
                    if (picked != null) {
                      setDialogState(() => startDate = picked);
                    }
                  },
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    'Time: ${startTime.format(ctx)}',
                    style: AppTypography.body,
                  ),
                  trailing: const Icon(
                    Icons.access_time,
                    color: AppColors.textSecondary,
                  ),
                  onTap: () async {
                    final picked = await showTimePicker(
                      context: ctx,
                      initialTime: startTime,
                    );
                    if (picked != null) {
                      setDialogState(() => startTime = picked);
                    }
                  },
                ),
                DropdownButtonFormField<String>(
                  value: category,
                  dropdownColor: AppColors.surface,
                  style: const TextStyle(color: AppColors.textPrimary),
                  decoration: const InputDecoration(labelText: 'Category'),
                  items: const [
                    DropdownMenuItem(value: 'general', child: Text('General')),
                    DropdownMenuItem(value: 'social', child: Text('Social')),
                    DropdownMenuItem(
                      value: 'fundraiser',
                      child: Text('Fundraiser'),
                    ),
                    DropdownMenuItem(
                      value: 'community',
                      child: Text('Community'),
                    ),
                    DropdownMenuItem(
                      value: 'workshop',
                      child: Text('Workshop'),
                    ),
                  ],
                  onChanged: (v) {
                    if (v != null) setDialogState(() => category = v);
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () async {
                if (titleCtrl.text.trim().isEmpty) return;
                final orgId = ref.read(authProvider).currentOrgId;
                if (orgId == null) return;
                final scheduledAt = DateTime(
                  startDate.year,
                  startDate.month,
                  startDate.day,
                  startTime.hour,
                  startTime.minute,
                );
                final body = <String, dynamic>{
                  'title': titleCtrl.text.trim(),
                  'description': descCtrl.text.trim(),
                  'location': locationCtrl.text.trim(),
                  'startDate': scheduledAt.toUtc().toIso8601String(),
                  'category': category,
                };
                try {
                  if (existing != null) {
                    await api.updateEvent(orgId, existing.id, body);
                  } else {
                    await api.createEvent(orgId, body);
                  }
                  if (ctx.mounted) Navigator.pop(ctx);
                  _loadEvents();
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
              child: Text(existing != null ? 'Update' : 'Create'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _deleteEvent(String eventId) async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Event'),
        content: const Text('Are you sure you want to delete this event?'),
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
      await api.deleteEvent(orgId, eventId);
      _loadEvents();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to delete event'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isAdmin = ref.watch(authProvider).isAdmin;

    return Scaffold(
      appBar: AppBar(
        leading: MediaQuery.of(context).size.width < 1024
            ? IconButton(
                icon: const Icon(Icons.menu, color: AppColors.highlight),
                onPressed: () => AppShell.openDrawer(),
              )
            : null,
        title: const Text('Events'),
      ),
      floatingActionButton: isAdmin
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
          : _events.isEmpty
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.event_outlined,
                    size: 64,
                    color: AppColors.textLight,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text('No events yet', style: AppTypography.bodySmall),
                  if (isAdmin) ...[
                    const SizedBox(height: AppSpacing.md),
                    ElevatedButton.icon(
                      onPressed: () => _showCreateOrEditDialog(),
                      icon: const Icon(Icons.add),
                      label: const Text('Create Event'),
                    ),
                  ],
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _loadEvents,
              child: ListView.builder(
                padding: const EdgeInsets.all(AppSpacing.md),
                itemCount: _events.length,
                itemBuilder: (_, i) {
                  final e = _events[i];
                  return Card(
                    margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                    child: Padding(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 48,
                                height: 48,
                                decoration: BoxDecoration(
                                  color: AppColors.highlightSubtle,
                                  borderRadius: BorderRadius.circular(
                                    AppRadius.sm,
                                  ),
                                ),
                                child: Builder(
                                  builder: (_) {
                                    final dt = DateTime.tryParse(e.startDate);
                                    if (dt != null) {
                                      return Column(
                                        mainAxisAlignment:
                                            MainAxisAlignment.center,
                                        children: [
                                          Text(
                                            _monthAbbrev(dt.month),
                                            style: const TextStyle(
                                              fontSize: 10,
                                              fontWeight: FontWeight.w700,
                                              color: AppColors.highlight,
                                            ),
                                          ),
                                          Text(
                                            '${dt.day}',
                                            style: const TextStyle(
                                              fontSize: 16,
                                              fontWeight: FontWeight.w800,
                                              color: AppColors.highlight,
                                            ),
                                          ),
                                        ],
                                      );
                                    }
                                    return const Icon(
                                      Icons.event,
                                      color: AppColors.highlight,
                                    );
                                  },
                                ),
                              ),
                              const SizedBox(width: AppSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(e.title, style: AppTypography.h4),
                                    if (e.location != null)
                                      Text(
                                        e.location!,
                                        style: AppTypography.caption,
                                      ),
                                  ],
                                ),
                              ),
                              if (isAdmin)
                                PopupMenuButton<String>(
                                  icon: const Icon(
                                    Icons.more_vert,
                                    color: AppColors.textSecondary,
                                  ),
                                  onSelected: (v) {
                                    if (v == 'edit') {
                                      _showCreateOrEditDialog(existing: e);
                                    }
                                    if (v == 'delete') {
                                      _deleteEvent(e.id);
                                    }
                                  },
                                  itemBuilder: (_) => [
                                    const PopupMenuItem(
                                      value: 'edit',
                                      child: Text('Edit'),
                                    ),
                                    const PopupMenuItem(
                                      value: 'delete',
                                      child: Text('Delete'),
                                    ),
                                  ],
                                ),
                            ],
                          ),
                          if (e.description != null &&
                              e.description!.isNotEmpty) ...[
                            const SizedBox(height: AppSpacing.sm),
                            Text(
                              e.description!,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                              style: AppTypography.bodySmall,
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
    );
  }

  String _monthAbbrev(int month) {
    const m = [
      'JAN',
      'FEB',
      'MAR',
      'APR',
      'MAY',
      'JUN',
      'JUL',
      'AUG',
      'SEP',
      'OCT',
      'NOV',
      'DEC',
    ];
    return m[month - 1];
  }
}
