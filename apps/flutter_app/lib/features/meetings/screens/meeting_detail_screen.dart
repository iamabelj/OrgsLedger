import 'package:flutter/material.dart';
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

class _MeetingDetailScreenState extends ConsumerState<MeetingDetailScreen> {
  Meeting? _meeting;
  bool _loading = true;
  bool _joining = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadMeeting();
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
      appBar: AppBar(title: Text(m.title)),
      body: RefreshIndicator(
        onRefresh: _loadMeeting,
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

              // Status badge
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
                    child: Text(
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
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.lg),

              // Info rows
              _InfoRow(
                icon: Icons.event,
                label: 'Date',
                value: m.scheduledStart != null
                    ? _formatDate(
                        DateTime.tryParse(m.scheduledStart!) ?? DateTime.now(),
                      )
                    : 'TBD',
              ),
              const SizedBox(height: AppSpacing.md),
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
                  ),
                ),

              if (!_isLive && !_isEnded && isAdmin) ...[
                ElevatedButton.icon(
                  onPressed: _startMeeting,
                  icon: const Icon(Icons.play_arrow),
                  label: const Text('Start Meeting'),
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
                  ),
                ),
              ],
            ],
          ),
        ),
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
