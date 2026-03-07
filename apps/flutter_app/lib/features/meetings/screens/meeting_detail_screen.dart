import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/models.dart';

class MeetingDetailScreen extends ConsumerStatefulWidget {
  final String meetingId;
  const MeetingDetailScreen({super.key, required this.meetingId});
  @override
  ConsumerState<MeetingDetailScreen> createState() =>
      _MeetingDetailScreenState();
}

class _MeetingDetailScreenState extends ConsumerState<MeetingDetailScreen>
    with SingleTickerProviderStateMixin {
  Meeting? _meeting;
  bool _loading = true;
  bool _joining = false;
  String? _error;

  // Post-meeting data
  List<Map<String, dynamic>> _transcripts = [];
  String? _minutes;
  bool _loadingExtras = false;
  bool _generatingMinutes = false;
  TabController? _tabCtrl;

  @override
  void initState() {
    super.initState();
    _loadMeeting();
  }

  @override
  void dispose() {
    _tabCtrl?.dispose();
    super.dispose();
  }

  Future<void> _loadMeeting() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    try {
      final res = await api.getMeeting(orgId, widget.meetingId);
      final data = res.data['data'] ?? res.data;
      if (mounted) {
        setState(() {
          _meeting = Meeting.fromJson(data);
          _loading = false;
        });
        _initTabsIfNeeded();
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool get _isLive => _meeting?.status == 'live';

  bool get _isEnded =>
      _meeting?.status == 'ended' || _meeting?.status == 'cancelled';

  Future<void> _joinMeeting() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    setState(() {
      _joining = true;
      _error = null;
    });
    try {
      final res = await api.joinMeeting(orgId, widget.meetingId, 'video');
      final data = res.data['data'] ?? res.data;
      final token = data['token']?.toString() ?? res.data['token']?.toString();
      if (token != null && mounted) {
        context.push(
          '/meetings/${widget.meetingId}/room?token=${Uri.encodeComponent(token)}',
        );
      }
      if (mounted) setState(() => _joining = false);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Failed to join meeting';
          _joining = false;
        });
      }
    }
  }

  Future<void> _startMeeting() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    try {
      await api.startMeeting(orgId, widget.meetingId);
      _loadMeeting();
    } catch (_) {}
  }

  Future<void> _endMeeting() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    // Optimistic: update UI immediately so buttons hide and status shows 'ended'
    if (mounted) {
      setState(() {
        _meeting = _meeting?.copyWith(status: 'ended');
      });
    }
    try {
      await api.endMeeting(orgId, widget.meetingId);
    } catch (_) {
      // Revert on failure
      _loadMeeting();
    }
  }

  void _initTabsIfNeeded() {
    if (_isEnded && _tabCtrl == null) {
      _tabCtrl = TabController(length: 3, vsync: this);
      _loadTranscriptsAndMinutes();
    }
  }

  Future<void> _loadTranscriptsAndMinutes() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    if (mounted) setState(() => _loadingExtras = true);
    try {
      final results = await Future.wait([
        api.getTranscripts(orgId, widget.meetingId),
        api.getMinutes(orgId, widget.meetingId),
      ]);
      final tData = results[0].data['data'] ?? results[0].data;
      final mData = results[1].data['data'] ?? results[1].data;
      if (mounted) {
        setState(() {
          _loadingExtras = false;
          if (tData is List) {
            _transcripts = tData.cast<Map<String, dynamic>>();
          }
          if (mData is Map<String, dynamic>) {
            _minutes =
                mData['summary']?.toString() ??
                mData['content']?.toString() ??
                mData['minutes']?.toString();
          } else if (mData is String && mData.isNotEmpty) {
            _minutes = mData;
          }
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingExtras = false);
    }
  }

  Future<void> _generateMinutes() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    setState(() => _generatingMinutes = true);
    try {
      await api.generateMinutes(orgId, widget.meetingId);
      await _loadTranscriptsAndMinutes();
    } catch (_) {}
    if (mounted) setState(() => _generatingMinutes = false);
  }

  String _formatDuration(Duration d) {
    if (d.inHours > 0) {
      return '${d.inHours}h ${d.inMinutes.remainder(60)}m';
    }
    return '${d.inMinutes}m';
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final isAdmin = auth.isAdmin;

    if (_loading) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(
          child: CircularProgressIndicator(color: AppColors.highlight),
        ),
      );
    }

    if (_meeting == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: Text('Meeting not found')),
      );
    }

    final m = _meeting!;

    return Scaffold(
      appBar: AppBar(
        title: Text(m.title),
        bottom: _isEnded && _tabCtrl != null
            ? TabBar(
                controller: _tabCtrl,
                tabs: const [
                  Tab(text: 'Overview'),
                  Tab(text: 'Transcripts'),
                  Tab(text: 'Minutes'),
                ],
              )
            : null,
      ),
      body: _isEnded && _tabCtrl != null
          ? TabBarView(
              controller: _tabCtrl,
              children: [
                _buildOverviewTab(m, isAdmin),
                _buildTranscriptsTab(),
                _buildMinutesTab(),
              ],
            )
          : _buildOverviewTab(m, isAdmin),
    );
  }

  Widget _buildOverviewTab(Meeting m, bool isAdmin) {
    final actualStart = m.actualStart != null
        ? DateTime.tryParse(m.actualStart!)
        : null;
    final actualEnd = m.actualEnd != null
        ? DateTime.tryParse(m.actualEnd!)
        : null;
    final duration = actualStart != null && actualEnd != null
        ? actualEnd.difference(actualStart)
        : null;

    return RefreshIndicator(
      onRefresh: () async {
        await _loadMeeting();
        if (_isEnded) await _loadTranscriptsAndMinutes();
      },
      color: AppColors.highlight,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_error != null)
              Container(
                padding: const EdgeInsets.all(AppSpacing.sm),
                margin: const EdgeInsets.only(bottom: AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.error.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Text(
                  _error!,
                  style: const TextStyle(color: AppColors.error),
                ),
              ),

            // Status header card
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(
                  color: _isLive
                      ? AppColors.success.withValues(alpha: 0.5)
                      : AppColors.border,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.sm,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: _isLive
                              ? AppColors.success
                              : _isEnded
                              ? AppColors.textLight
                              : AppColors.info,
                          borderRadius: BorderRadius.circular(AppRadius.sm),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (_isLive)
                              const Padding(
                                padding: EdgeInsets.only(right: 4),
                                child: Icon(
                                  Icons.fiber_manual_record,
                                  color: Colors.white,
                                  size: 8,
                                ),
                              ),
                            Text(
                              _isLive
                                  ? 'LIVE'
                                  : _isEnded
                                  ? 'ENDED'
                                  : 'SCHEDULED',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Spacer(),
                      if (m.meetingType != null)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.sm,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceAlt,
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                          ),
                          child: Text(
                            m.meetingType!.toUpperCase(),
                            style: AppTypography.caption.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _InfoRow(
                    icon: Icons.event,
                    label: 'Scheduled',
                    value: m.scheduledStart != null
                        ? _formatDate(
                            DateTime.tryParse(m.scheduledStart!) ??
                                DateTime.now(),
                          )
                        : 'TBD',
                  ),
                  if (duration != null) ...[
                    const SizedBox(height: AppSpacing.sm),
                    _InfoRow(
                      icon: Icons.timer,
                      label: 'Duration',
                      value: _formatDuration(duration),
                    ),
                  ],
                  if (m.attendance.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.sm),
                    _InfoRow(
                      icon: Icons.people,
                      label: 'Attended',
                      value:
                          '${m.attendance.length} participant${m.attendance.length != 1 ? 's' : ''}',
                    ),
                  ],
                  if (m.location != null && m.location!.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.sm),
                    _InfoRow(
                      icon: Icons.location_on,
                      label: 'Location',
                      value: m.location!,
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.lg),

            // Agenda
            if (m.description != null && m.description!.isNotEmpty) ...[
              Text('Agenda', style: AppTypography.label),
              const SizedBox(height: AppSpacing.xs),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.surfaceAlt,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Text(m.description!, style: AppTypography.body),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],

            // Agenda items
            if (m.agendaItems.isNotEmpty) ...[
              Text('Agenda Items', style: AppTypography.label),
              const SizedBox(height: AppSpacing.xs),
              ...m.agendaItems.asMap().entries.map((entry) {
                final item = entry.value;
                final title = item is Map
                    ? (item['title']?.toString() ?? item.toString())
                    : item.toString();
                return Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.xs),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 24,
                        height: 24,
                        decoration: BoxDecoration(
                          color: AppColors.highlightSubtle,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          '${entry.key + 1}',
                          style: TextStyle(
                            fontSize: 12,
                            color: AppColors.highlight,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(top: 3),
                          child: Text(title, style: AppTypography.body),
                        ),
                      ),
                    ],
                  ),
                );
              }),
              const SizedBox(height: AppSpacing.lg),
            ],

            // Attendance list for ended meetings
            if (_isEnded && m.attendance.isNotEmpty) ...[
              Text('Attendance', style: AppTypography.label),
              const SizedBox(height: AppSpacing.xs),
              Container(
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                  border: Border.all(color: AppColors.border),
                ),
                child: Column(
                  children: m.attendance.take(20).toList().asMap().entries.map((
                    entry,
                  ) {
                    final a = entry.value;
                    final name = a is Map
                        ? (a['userName']?.toString() ??
                              a['name']?.toString() ??
                              'Member')
                        : 'Member';
                    final joinedAt = a is Map && a['joinedAt'] != null
                        ? DateTime.tryParse(a['joinedAt'].toString())
                        : null;
                    return Column(
                      children: [
                        if (entry.key > 0)
                          const Divider(height: 1, color: AppColors.border),
                        Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.md,
                            vertical: AppSpacing.sm,
                          ),
                          child: Row(
                            children: [
                              CircleAvatar(
                                radius: 14,
                                backgroundColor: AppColors.highlightSubtle,
                                child: Text(
                                  name.isNotEmpty ? name[0].toUpperCase() : '?',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.highlight,
                                  ),
                                ),
                              ),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: Text(
                                  name,
                                  style: AppTypography.body.copyWith(
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                              if (joinedAt != null)
                                Text(
                                  '${joinedAt.hour.toString().padLeft(2, '0')}:${joinedAt.minute.toString().padLeft(2, '0')}',
                                  style: AppTypography.caption,
                                ),
                            ],
                          ),
                        ),
                      ],
                    );
                  }).toList(),
                ),
              ),
              if (m.attendance.length > 20)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.xs),
                  child: Text(
                    '+${m.attendance.length - 20} more',
                    style: AppTypography.caption.copyWith(
                      color: AppColors.textSecondary,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
              const SizedBox(height: AppSpacing.lg),
            ],

            // Action buttons
            if (_isLive)
              ElevatedButton.icon(
                onPressed: _joining ? null : _joinMeeting,
                icon: const Icon(Icons.videocam),
                label: _joining
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Join Meeting'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.success,
                  minimumSize: const Size(double.infinity, 48),
                ),
              ),

            if (!_isLive && !_isEnded && isAdmin) ...[
              ElevatedButton.icon(
                onPressed: _startMeeting,
                icon: const Icon(Icons.play_arrow),
                label: const Text('Start Meeting'),
                style: ElevatedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 48),
                ),
              ),
            ],

            if (_isLive && isAdmin) ...[
              const SizedBox(height: AppSpacing.sm),
              OutlinedButton.icon(
                onPressed: _endMeeting,
                icon: const Icon(Icons.stop, color: AppColors.error),
                label: const Text(
                  'End Meeting',
                  style: TextStyle(color: AppColors.error),
                ),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: AppColors.error),
                  minimumSize: const Size(double.infinity, 48),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildTranscriptsTab() {
    if (_loadingExtras) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.highlight),
      );
    }

    if (_transcripts.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.subtitles_off,
              size: 64,
              color: AppColors.textLight,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              'No transcripts available',
              style: AppTypography.body.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Transcripts are generated when AI is\nenabled during a meeting.',
              textAlign: TextAlign.center,
              style: AppTypography.bodySmall.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadTranscriptsAndMinutes,
      color: AppColors.highlight,
      child: ListView.builder(
        padding: const EdgeInsets.all(AppSpacing.md),
        itemCount: _transcripts.length,
        itemBuilder: (_, i) {
          final t = _transcripts[i];
          final speaker =
              t['speakerName']?.toString() ??
              t['speaker']?.toString() ??
              'Unknown';
          final text = t['text']?.toString() ?? t['content']?.toString() ?? '';
          final time = t['createdAt'] != null
              ? DateTime.tryParse(t['createdAt'].toString())
              : null;
          return Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CircleAvatar(
                    radius: 16,
                    backgroundColor: AppColors.highlightSubtle,
                    child: Text(
                      speaker.isNotEmpty ? speaker[0].toUpperCase() : '?',
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.highlight,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              speaker,
                              style: AppTypography.label.copyWith(
                                color: AppColors.highlight,
                              ),
                            ),
                            if (time != null) ...[
                              const Spacer(),
                              Text(
                                '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}',
                                style: AppTypography.caption,
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          text,
                          style: AppTypography.body.copyWith(height: 1.4),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildMinutesTab() {
    if (_loadingExtras) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.highlight),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_minutes == null) ...[
            // No minutes yet - show generate prompt
            Container(
              padding: const EdgeInsets.all(AppSpacing.xl),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                children: [
                  const Icon(
                    Icons.auto_awesome,
                    size: 48,
                    color: AppColors.highlight,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text('No minutes generated yet', style: AppTypography.h4),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'Generate an AI summary of the meeting\nincluding key points and action items.',
                    textAlign: TextAlign.center,
                    style: AppTypography.bodySmall.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  ElevatedButton.icon(
                    onPressed: _generatingMinutes ? null : _generateMinutes,
                    icon: _generatingMinutes
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.auto_awesome),
                    label: Text(
                      _generatingMinutes
                          ? 'Generating...'
                          : 'Generate AI Minutes',
                    ),
                    style: ElevatedButton.styleFrom(
                      minimumSize: const Size(200, 44),
                    ),
                  ),
                ],
              ),
            ),
          ] else ...[
            // Minutes display
            Row(
              children: [
                const Icon(
                  Icons.summarize,
                  size: 20,
                  color: AppColors.highlight,
                ),
                const SizedBox(width: AppSpacing.sm),
                Text('Meeting Minutes', style: AppTypography.h4),
                const Spacer(),
                IconButton(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: _minutes!));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Minutes copied to clipboard'),
                      ),
                    );
                  },
                  icon: const Icon(
                    Icons.copy,
                    size: 18,
                    color: AppColors.textSecondary,
                  ),
                  tooltip: 'Copy',
                  visualDensity: VisualDensity.compact,
                ),
                IconButton(
                  onPressed: _generatingMinutes ? null : _generateMinutes,
                  icon: _generatingMinutes
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(
                          Icons.refresh,
                          size: 18,
                          color: AppColors.textSecondary,
                        ),
                  tooltip: 'Regenerate',
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.lg),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(color: AppColors.border),
              ),
              child: SelectableText(
                _minutes!,
                style: AppTypography.body.copyWith(height: 1.6),
              ),
            ),
          ],
        ],
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

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: AppColors.textSecondary),
        const SizedBox(width: AppSpacing.sm),
        Text('$label: ', style: AppTypography.label),
        Expanded(child: Text(value, style: AppTypography.body)),
      ],
    );
  }
}
