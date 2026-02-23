import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/models.dart';

class PollsScreen extends ConsumerStatefulWidget {
  const PollsScreen({super.key});
  @override
  ConsumerState<PollsScreen> createState() => _PollsScreenState();
}

class _PollsScreenState extends ConsumerState<PollsScreen> {
  List<Poll> _polls = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadPolls();
  }

  Future<void> _loadPolls() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) {
      setState(() => _loading = false);
      return;
    }
    try {
      final res = await api.getPolls(orgId);
      final data = (res.data['data'] ?? res.data) as List? ?? [];
      if (mounted) {
        setState(() {
          _polls = data.map((p) => Poll.fromJson(p)).toList();
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _vote(String pollId, String optionId) async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    try {
      await api.votePoll(orgId, pollId, {'option_id': optionId});
      _loadPolls();
    } catch (_) {}
  }

  void _showCreatePollDialog() {
    final titleCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    final optionCtrls = <TextEditingController>[
      TextEditingController(),
      TextEditingController(),
    ];

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Create Poll'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: titleCtrl,
                  decoration: const InputDecoration(labelText: 'Question *'),
                  style: const TextStyle(color: AppColors.textPrimary),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: descCtrl,
                  decoration: const InputDecoration(labelText: 'Description'),
                  style: const TextStyle(color: AppColors.textPrimary),
                  maxLines: 2,
                ),
                const SizedBox(height: AppSpacing.md),
                Text('Options', style: AppTypography.label),
                const SizedBox(height: AppSpacing.xs),
                ...List.generate(optionCtrls.length, (i) {
                  return Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: optionCtrls[i],
                            decoration: InputDecoration(
                              labelText: 'Option ${i + 1}',
                            ),
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                            ),
                          ),
                        ),
                        if (optionCtrls.length > 2)
                          IconButton(
                            icon: const Icon(
                              Icons.remove_circle,
                              color: AppColors.error,
                            ),
                            onPressed: () {
                              setDialogState(() {
                                optionCtrls.removeAt(i);
                              });
                            },
                          ),
                      ],
                    ),
                  );
                }),
                if (optionCtrls.length < 10)
                  TextButton.icon(
                    onPressed: () {
                      setDialogState(() {
                        optionCtrls.add(TextEditingController());
                      });
                    },
                    icon: const Icon(Icons.add, color: AppColors.highlight),
                    label: const Text(
                      'Add Option',
                      style: TextStyle(color: AppColors.highlight),
                    ),
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
                final options = optionCtrls
                    .map((c) => c.text.trim())
                    .where((t) => t.isNotEmpty)
                    .toList();
                if (options.length < 2) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('At least 2 options required'),
                      backgroundColor: AppColors.error,
                    ),
                  );
                  return;
                }
                final orgId = ref.read(authProvider).currentOrgId;
                if (orgId == null) return;
                try {
                  await api.createPoll(orgId, {
                    'title': titleCtrl.text.trim(),
                    'description': descCtrl.text.trim(),
                    'options': options,
                  });
                  if (ctx.mounted) Navigator.pop(ctx);
                  _loadPolls();
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
              child: const Text('Create'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _closePoll(String pollId) async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    try {
      await api.closePoll(orgId, pollId);
      _loadPolls();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to close poll'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  void _showEditPollDialog(Poll poll) {
    final titleCtrl = TextEditingController(text: poll.title);
    final descCtrl = TextEditingController(text: poll.description ?? '');

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Edit Poll'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: titleCtrl,
                decoration: const InputDecoration(labelText: 'Question *'),
                style: const TextStyle(color: AppColors.textPrimary),
              ),
              const SizedBox(height: AppSpacing.sm),
              TextField(
                controller: descCtrl,
                decoration: const InputDecoration(labelText: 'Description'),
                style: const TextStyle(color: AppColors.textPrimary),
                maxLines: 2,
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
              try {
                await api.updatePoll(orgId, poll.id, {
                  'title': titleCtrl.text.trim(),
                  'description': descCtrl.text.trim(),
                });
                if (ctx.mounted) Navigator.pop(ctx);
                _loadPolls();
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
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isAdmin = ref.watch(authProvider).isAdmin;

    return Scaffold(
      appBar: AppBar(title: const Text('Polls')),
      floatingActionButton: isAdmin
          ? FloatingActionButton(
              onPressed: _showCreatePollDialog,
              backgroundColor: AppColors.highlight,
              child: const Icon(Icons.add, color: AppColors.background),
            )
          : null,
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.highlight),
            )
          : _polls.isEmpty
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.poll_outlined,
                    size: 64,
                    color: AppColors.textLight,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text('No polls yet', style: AppTypography.bodySmall),
                  if (isAdmin) ...[
                    const SizedBox(height: AppSpacing.md),
                    ElevatedButton.icon(
                      onPressed: _showCreatePollDialog,
                      icon: const Icon(Icons.add),
                      label: const Text('Create Poll'),
                    ),
                  ],
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _loadPolls,
              child: ListView.builder(
                padding: const EdgeInsets.all(AppSpacing.md),
                itemCount: _polls.length,
                itemBuilder: (_, i) => _PollCard(
                  poll: _polls[i],
                  onVote: _vote,
                  onClose: isAdmin ? _closePoll : null,
                  onEdit: isAdmin ? _showEditPollDialog : null,
                ),
              ),
            ),
    );
  }
}

class _PollCard extends StatelessWidget {
  final Poll poll;
  final Function(String pollId, String optionId) onVote;
  final Function(String pollId)? onClose;
  final Function(Poll poll)? onEdit;
  const _PollCard({
    required this.poll,
    required this.onVote,
    this.onClose,
    this.onEdit,
  });

  @override
  Widget build(BuildContext context) {
    final totalVotes = poll.options.fold<int>(0, (sum, o) => sum + o.voteCount);
    final isActive = poll.status == 'active' || poll.status == 'open';

    return Card(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(poll.title, style: AppTypography.h4)),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: isActive
                        ? AppColors.success.withValues(alpha: 0.15)
                        : AppColors.textLight.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    isActive ? 'ACTIVE' : 'CLOSED',
                    style: TextStyle(
                      color: isActive ? AppColors.success : AppColors.textLight,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (onClose != null && isActive)
                  IconButton(
                    icon: const Icon(
                      Icons.close,
                      color: AppColors.textSecondary,
                      size: 20,
                    ),
                    tooltip: 'Close poll',
                    onPressed: () => onClose!(poll.id),
                  ),
                if (onEdit != null && isActive)
                  IconButton(
                    icon: const Icon(
                      Icons.edit,
                      color: AppColors.textSecondary,
                      size: 20,
                    ),
                    tooltip: 'Edit poll',
                    onPressed: () => onEdit!(poll),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            ...poll.options.map((o) {
              final pct = totalVotes > 0
                  ? (o.voteCount / totalVotes * 100)
                  : 0.0;
              return Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: InkWell(
                  onTap: isActive ? () => onVote(poll.id, o.id) : null,
                  child: Container(
                    padding: const EdgeInsets.all(AppSpacing.sm),
                    decoration: BoxDecoration(
                      border: Border.all(
                        color: o.hasVoted
                            ? AppColors.highlight
                            : AppColors.border.withValues(alpha: 0.3),
                        width: o.hasVoted ? 2 : 1,
                      ),
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            if (o.hasVoted)
                              const Padding(
                                padding: EdgeInsets.only(right: 6),
                                child: Icon(
                                  Icons.check_circle,
                                  color: AppColors.highlight,
                                  size: 16,
                                ),
                              ),
                            Expanded(
                              child: Text(o.text, style: AppTypography.body),
                            ),
                            Text(
                              '${pct.toStringAsFixed(0)}%',
                              style: AppTypography.caption,
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(2),
                          child: LinearProgressIndicator(
                            value: pct / 100,
                            backgroundColor: AppColors.border.withValues(
                              alpha: 0.2,
                            ),
                            color: AppColors.highlight,
                            minHeight: 4,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }),
            Text(
              '$totalVotes vote${totalVotes == 1 ? '' : 's'}',
              style: AppTypography.caption,
            ),
          ],
        ),
      ),
    );
  }
}
