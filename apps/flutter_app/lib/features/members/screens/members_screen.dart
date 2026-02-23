import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';

class MembersScreen extends ConsumerStatefulWidget {
  const MembersScreen({super.key});
  @override
  ConsumerState<MembersScreen> createState() => _MembersScreenState();
}

class _MembersScreenState extends ConsumerState<MembersScreen> {
  List<Map<String, dynamic>> _members = [];
  bool _loading = true;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _loadMembers();
  }

  Future<void> _loadMembers() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) {
      setState(() => _loading = false);
      return;
    }
    try {
      final res = await api.getMembers(orgId);
      final rawData = res.data['data'] ?? res.data['members'] ?? res.data;
      List data;
      if (rawData is List) {
        data = rawData;
      } else if (rawData is Map && rawData['members'] is List) {
        data = rawData['members'] as List;
      } else {
        data = [];
      }
      if (mounted) {
        setState(() {
          _members = data.whereType<Map<String, dynamic>>().toList();
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _filtered {
    if (_search.isEmpty) return _members;
    final q = _search.toLowerCase();
    return _members.where((m) {
      final name =
          '${m['first_name'] ?? m['firstName'] ?? ''} ${m['last_name'] ?? m['lastName'] ?? ''}'
              .toLowerCase();
      final email = (m['email'] ?? '').toString().toLowerCase();
      return name.contains(q) || email.contains(q);
    }).toList();
  }

  void _showInviteDialog() {
    String role = 'member';
    bool generating = false;
    String? inviteLink;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Invite Member'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Generate an invite link to share with new members.'),
              const SizedBox(height: AppSpacing.md),
              DropdownButtonFormField<String>(
                initialValue: role,
                dropdownColor: AppColors.surface,
                style: const TextStyle(color: AppColors.textPrimary),
                decoration: const InputDecoration(labelText: 'Role'),
                items: const [
                  DropdownMenuItem(value: 'member', child: Text('Member')),
                  DropdownMenuItem(
                    value: 'executive',
                    child: Text('Executive'),
                  ),
                ],
                onChanged: (v) {
                  if (v != null) setDialogState(() => role = v);
                },
              ),
              const SizedBox(height: AppSpacing.md),
              if (inviteLink != null) ...[
                Container(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceAlt,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                    border: Border.all(color: AppColors.highlight),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          inviteLink!,
                          style: const TextStyle(
                            color: AppColors.highlight,
                            fontSize: 12,
                          ),
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      IconButton(
                        icon: const Icon(
                          Icons.copy,
                          color: AppColors.highlight,
                          size: 20,
                        ),
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: inviteLink!));
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Link copied to clipboard'),
                              backgroundColor: AppColors.success,
                            ),
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Close'),
            ),
            if (inviteLink == null)
              ElevatedButton(
                onPressed: generating
                    ? null
                    : () async {
                        final orgId = ref.read(authProvider).currentOrgId;
                        if (orgId == null) return;
                        setDialogState(() => generating = true);
                        try {
                          final res = await api.createInvite(orgId, {
                            'role': role,
                            'maxUses': 10,
                          });
                          final data = res.data['data'] ?? res.data;
                          final code =
                              data['code']?.toString() ??
                              data['invite_code']?.toString() ??
                              '';
                          if (code.isNotEmpty) {
                            setDialogState(() {
                              inviteLink =
                                  'https://app.orgsledger.com/invite/$code';
                              generating = false;
                            });
                          } else {
                            setDialogState(() => generating = false);
                          }
                        } catch (e) {
                          setDialogState(() => generating = false);
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
                child: generating
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Generate Link'),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isAdmin = ref.watch(authProvider).isAdmin;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Members'),
        actions: [
          if (isAdmin)
            IconButton(
              icon: const Icon(Icons.person_add, color: AppColors.highlight),
              tooltip: 'Invite member',
              onPressed: _showInviteDialog,
            ),
        ],
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.highlight),
            )
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  child: TextField(
                    style: const TextStyle(color: AppColors.textPrimary),
                    decoration: const InputDecoration(
                      hintText: 'Search members...',
                      prefixIcon: Icon(
                        Icons.search,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    onChanged: (v) => setState(() => _search = v),
                  ),
                ),
                if (isAdmin)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.md,
                    ),
                    child: SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: _showInviteDialog,
                        icon: const Icon(
                          Icons.link,
                          color: AppColors.highlight,
                        ),
                        label: const Text(
                          'Generate Invite Link',
                          style: TextStyle(color: AppColors.highlight),
                        ),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: AppColors.highlight),
                        ),
                      ),
                    ),
                  ),
                const SizedBox(height: AppSpacing.sm),
                Expanded(
                  child: _filtered.isEmpty
                      ? Center(
                          child: Text(
                            'No members found',
                            style: AppTypography.bodySmall,
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: _loadMembers,
                          child: ListView.builder(
                            itemCount: _filtered.length,
                            itemBuilder: (_, i) {
                              final m = _filtered[i];
                              final name =
                                  '${m['first_name'] ?? m['firstName'] ?? ''} ${m['last_name'] ?? m['lastName'] ?? ''}'
                                      .trim();
                              final role = m['role']?.toString() ?? 'member';
                              final email = m['email']?.toString() ?? '';
                              return ListTile(
                                leading: CircleAvatar(
                                  backgroundColor: AppColors.highlightSubtle,
                                  child: Text(
                                    name.isNotEmpty
                                        ? name[0].toUpperCase()
                                        : '?',
                                    style: TextStyle(
                                      color: AppColors.highlight,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                                title: Text(
                                  name.isNotEmpty ? name : email,
                                  style: AppTypography.body,
                                ),
                                subtitle: Text(
                                  role,
                                  style: AppTypography.caption,
                                ),
                                trailing:
                                    role == 'org_admin' ||
                                        role == 'executive' ||
                                        role == 'super_admin'
                                    ? Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 8,
                                          vertical: 2,
                                        ),
                                        decoration: BoxDecoration(
                                          color: AppColors.highlight.withValues(
                                            alpha: 0.15,
                                          ),
                                          borderRadius: BorderRadius.circular(
                                            10,
                                          ),
                                        ),
                                        child: Text(
                                          role.toUpperCase(),
                                          style: const TextStyle(
                                            color: AppColors.highlight,
                                            fontSize: 10,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      )
                                    : null,
                              );
                            },
                          ),
                        ),
                ),
              ],
            ),
    );
  }
}
