import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/models.dart';
import '../../../data/socket/socket_client.dart';

class MeetingsListScreen extends ConsumerStatefulWidget {
  const MeetingsListScreen({super.key});
  @override
  ConsumerState<MeetingsListScreen> createState() => _MeetingsListScreenState();
}

class _MeetingsListScreenState extends ConsumerState<MeetingsListScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabCtrl;
  List<Meeting> _meetings = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 3, vsync: this);
    _loadMeetings();
    _listenSocket();
  }

  void _listenSocket() {
    socketClient.on('meeting:started', (_) => _loadMeetings());
    socketClient.on('meeting:ended', (_) => _loadMeetings());
    socketClient.on('meeting:scheduled', (_) => _loadMeetings());
  }

  Future<void> _loadMeetings() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) {
      setState(() => _loading = false);
      return;
    }
    try {
      final res = await api.getMeetings(orgId);
      final data = (res.data['data'] ?? res.data) as List? ?? [];
      if (mounted) {
        setState(() {
          _meetings = data.map((m) => Meeting.fromJson(m)).toList();
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Meeting> _filtered(String status) {
    if (status == 'live') {
      return _meetings.where((m) => m.status == 'live').toList();
    } else if (status == 'scheduled') {
      return _meetings.where((m) => m.status == 'scheduled').toList();
    } else {
      return _meetings
          .where((m) => m.status == 'ended' || m.status == 'cancelled')
          .toList();
    }
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    socketClient.off('meeting:started');
    socketClient.off('meeting:ended');
    socketClient.off('meeting:scheduled');
    super.dispose();
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
        title: const Text('Meetings'),
        bottom: TabBar(
          controller: _tabCtrl,
          tabs: const [
            Tab(text: 'Live'),
            Tab(text: 'Scheduled'),
            Tab(text: 'Ended'),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.push('/meetings/create'),
        child: const Icon(Icons.add),
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.highlight),
            )
          : TabBarView(
              controller: _tabCtrl,
              children: [
                _buildList(_filtered('live'), 'No live meetings'),
                _buildList(_filtered('scheduled'), 'No scheduled meetings'),
                _buildList(_filtered('ended'), 'No past meetings'),
              ],
            ),
    );
  }

  Widget _buildList(List<Meeting> meetings, String emptyText) {
    if (meetings.isEmpty) {
      return RefreshIndicator(
        onRefresh: _loadMeetings,
        color: AppColors.highlight,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(
              height: MediaQuery.of(context).size.height * 0.5,
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.videocam_off_outlined,
                      size: 64,
                      color: AppColors.textLight,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Text(emptyText, style: AppTypography.bodySmall),
                  ],
                ),
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadMeetings,
      child: ListView.builder(
        padding: const EdgeInsets.all(AppSpacing.md),
        itemCount: meetings.length,
        itemBuilder: (_, i) {
          final m = meetings[i];
          final isLive = m.status == 'live';
          return Card(
            margin: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: isLive
                    ? AppColors.success
                    : AppColors.primaryLight,
                child: Icon(
                  isLive ? Icons.videocam : Icons.event,
                  color: isLive ? Colors.white : AppColors.highlight,
                  size: 20,
                ),
              ),
              title: Text(m.title, style: AppTypography.body),
              subtitle: Text(
                m.scheduledStart != null
                    ? _formatDate(
                        DateTime.tryParse(m.scheduledStart!) ?? DateTime.now(),
                      )
                    : 'No date set',
                style: AppTypography.caption,
              ),
              trailing: isLive
                  ? ElevatedButton(
                      onPressed: () => context.push('/meetings/${m.id}'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.success,
                      ),
                      child: const Text('Join'),
                    )
                  : const Icon(Icons.chevron_right, color: AppColors.textLight),
              onTap: () => context.push('/meetings/${m.id}'),
            ),
          );
        },
      ),
    );
  }

  String _formatDate(DateTime dt) {
    final months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${months[dt.month - 1]} ${dt.day}, ${dt.year} at '
        '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }
}
