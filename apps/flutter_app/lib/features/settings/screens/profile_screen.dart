import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});
  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  late TextEditingController _firstNameCtrl;
  late TextEditingController _lastNameCtrl;
  late TextEditingController _emailCtrl;
  late TextEditingController _phoneCtrl;
  bool _saving = false;
  String? _message;
  bool _isError = false;

  // Org info
  String? _orgName;
  String? _role;
  String? _joinDate;
  String? _orgCurrency;
  int _totalMembers = 0;

  @override
  void initState() {
    super.initState();
    final user = ref.read(authProvider).user;
    _firstNameCtrl = TextEditingController(text: user?.firstName ?? '');
    _lastNameCtrl = TextEditingController(text: user?.lastName ?? '');
    _emailCtrl = TextEditingController(text: user?.email ?? '');
    _phoneCtrl = TextEditingController(text: user?.phone ?? '');
    _loadOrgInfo();
  }

  Future<void> _loadOrgInfo() async {
    final auth = ref.read(authProvider);
    final orgId = auth.currentOrgId;
    final membership = auth.currentMembership;
    if (membership != null) {
      _orgName = membership.orgName;
      _role = membership.role;
    }
    if (orgId == null) return;

    try {
      final results = await Future.wait([
        api.getOrganization(orgId),
        api.getMembers(orgId),
      ]);

      final orgData = results[0].data['data'] ?? results[0].data;
      final membersData = results[1].data['data'] ?? results[1].data;

      if (mounted) {
        setState(() {
          if (orgData is Map<String, dynamic>) {
            _orgName = orgData['name']?.toString() ?? _orgName;
            final settings = orgData['settings'] is Map<String, dynamic>
                ? orgData['settings'] as Map<String, dynamic>
                : <String, dynamic>{};
            _orgCurrency =
                settings['currency']?.toString() ??
                orgData['currency']?.toString();
            _joinDate =
                orgData['created_at']?.toString() ??
                orgData['createdAt']?.toString();
          }
          if (membersData is List) {
            _totalMembers = membersData.length;
            // Find this user's join date from membership
            final myId = ref.read(authProvider).user?.id;
            for (final m in membersData) {
              if (m is Map<String, dynamic>) {
                final uid =
                    m['user_id']?.toString() ??
                    m['userId']?.toString() ??
                    m['id']?.toString();
                if (uid == myId) {
                  _joinDate =
                      m['joined_at']?.toString() ??
                      m['created_at']?.toString() ??
                      m['createdAt']?.toString() ??
                      _joinDate;
                  break;
                }
              }
            }
          }
        });
      }
    } catch (_) {}
  }

  Future<void> _refresh() async {
    await ref.read(authProvider.notifier).loadUser();
    final user = ref.read(authProvider).user;
    if (user != null && mounted) {
      setState(() {
        _firstNameCtrl.text = user.firstName ?? '';
        _lastNameCtrl.text = user.lastName ?? '';
        _emailCtrl.text = user.email;
        _phoneCtrl.text = user.phone ?? '';
      });
    }
    await _loadOrgInfo();
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _message = null;
    });
    try {
      await api.updateProfile({
        'firstName': _firstNameCtrl.text.trim(),
        'lastName': _lastNameCtrl.text.trim(),
        'phone': _phoneCtrl.text.trim().isEmpty ? null : _phoneCtrl.text.trim(),
      });
      await ref.read(authProvider.notifier).loadUser();
      if (mounted) {
        setState(() {
          _message = 'Profile updated successfully';
          _isError = false;
          _saving = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _message = 'Failed to update profile';
          _isError = true;
          _saving = false;
        });
      }
    }
  }

  Future<void> _pickAvatar() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 512,
    );
    if (picked == null) return;
    try {
      await api.uploadAvatar(picked.path);
      await ref.read(authProvider.notifier).loadUser();
      if (mounted) {
        setState(() {
          _message = 'Avatar updated';
          _isError = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _message = 'Failed to upload avatar';
          _isError = true;
        });
      }
    }
  }

  @override
  void dispose() {
    _firstNameCtrl.dispose();
    _lastNameCtrl.dispose();
    _emailCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  String _formatRole(String? role) {
    if (role == null) return 'Member';
    switch (role) {
      case 'org_admin':
        return 'Organization Admin';
      case 'executive':
        return 'Executive';
      case 'member':
        return 'Member';
      default:
        return role.replaceAll('_', ' ');
    }
  }

  String _formatDate(String? dateStr) {
    if (dateStr == null) return 'N/A';
    final dt = DateTime.tryParse(dateStr);
    if (dt == null) return dateStr;
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
    return '${months[dt.month - 1]} ${dt.day}, ${dt.year}';
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final user = auth.user;
    final isDesktop = MediaQuery.of(context).size.width >= 1024;

    return Scaffold(
      appBar: AppBar(
        leading: isDesktop
            ? null
            : IconButton(
                icon: const Icon(Icons.menu, color: AppColors.highlight),
                onPressed: () => AppShell.openDrawer(),
              ),
        title: const Text('Profile'),
        actions: [
          TextButton.icon(
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.highlight,
                    ),
                  )
                : const Icon(Icons.check, color: AppColors.highlight),
            label: Text(
              'Save',
              style: TextStyle(
                color: _saving ? AppColors.textLight : AppColors.highlight,
              ),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        color: AppColors.highlight,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // ── Avatar ──
              GestureDetector(
                onTap: _pickAvatar,
                child: Stack(
                  children: [
                    CircleAvatar(
                      radius: 50,
                      backgroundColor: AppColors.highlightSubtle,
                      backgroundImage: user?.avatarUrl != null
                          ? NetworkImage(user!.avatarUrl!)
                          : null,
                      child: user?.avatarUrl == null
                          ? Text(
                              (user?.firstName ?? '?')[0].toUpperCase(),
                              style: const TextStyle(
                                fontSize: 32,
                                fontWeight: FontWeight.w700,
                                color: AppColors.highlight,
                              ),
                            )
                          : null,
                    ),
                    Positioned(
                      bottom: 0,
                      right: 0,
                      child: Container(
                        padding: const EdgeInsets.all(4),
                        decoration: const BoxDecoration(
                          color: AppColors.highlight,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.camera_alt,
                          size: 16,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(user?.displayName ?? 'User', style: AppTypography.h3),
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: AppColors.highlightSubtle,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Text(
                  _formatRole(_role),
                  style: TextStyle(
                    color: AppColors.highlight,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),

              // ── Status message ──
              if (_message != null)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  margin: const EdgeInsets.only(bottom: AppSpacing.md),
                  decoration: BoxDecoration(
                    color: _isError
                        ? AppColors.error.withValues(alpha: 0.1)
                        : AppColors.success.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Text(
                    _message!,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: _isError ? AppColors.error : AppColors.success,
                    ),
                  ),
                ),

              // ── Organization Info Card ──
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(
                            Icons.business,
                            color: AppColors.highlight,
                            size: 20,
                          ),
                          const SizedBox(width: AppSpacing.sm),
                          Text('Organization', style: AppTypography.label),
                        ],
                      ),
                      const Divider(),
                      _InfoTile(
                        icon: Icons.shield,
                        label: 'Organization',
                        value: _orgName ?? 'N/A',
                      ),
                      _InfoTile(
                        icon: Icons.badge,
                        label: 'Your Role',
                        value: _formatRole(_role),
                      ),
                      _InfoTile(
                        icon: Icons.calendar_today,
                        label: 'Member Since',
                        value: _formatDate(_joinDate),
                      ),
                      _InfoTile(
                        icon: Icons.people,
                        label: 'Total Members',
                        value: _totalMembers > 0 ? '$_totalMembers' : 'N/A',
                      ),
                      if (_orgCurrency != null)
                        _InfoTile(
                          icon: Icons.attach_money,
                          label: 'Currency',
                          value: _orgCurrency!,
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),

              // ── Personal Details Section ──
              Align(
                alignment: Alignment.centerLeft,
                child: Row(
                  children: [
                    const Icon(
                      Icons.person,
                      color: AppColors.highlight,
                      size: 20,
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Text('Personal Details', style: AppTypography.label),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              TextField(
                controller: _firstNameCtrl,
                style: const TextStyle(color: AppColors.textPrimary),
                decoration: const InputDecoration(
                  labelText: 'First Name',
                  prefixIcon: Icon(
                    Icons.person_outline,
                    size: 20,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              TextField(
                controller: _lastNameCtrl,
                style: const TextStyle(color: AppColors.textPrimary),
                decoration: const InputDecoration(
                  labelText: 'Last Name',
                  prefixIcon: Icon(
                    Icons.person_outline,
                    size: 20,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              TextField(
                controller: _emailCtrl,
                style: const TextStyle(color: AppColors.textSecondary),
                decoration: const InputDecoration(
                  labelText: 'Email',
                  prefixIcon: Icon(
                    Icons.email_outlined,
                    size: 20,
                    color: AppColors.textSecondary,
                  ),
                ),
                readOnly: true,
              ),
              const SizedBox(height: AppSpacing.md),
              TextField(
                controller: _phoneCtrl,
                style: const TextStyle(color: AppColors.textPrimary),
                decoration: const InputDecoration(
                  labelText: 'Phone Number',
                  hintText: '+1 234 567 8900',
                  prefixIcon: Icon(
                    Icons.phone_outlined,
                    size: 20,
                    color: AppColors.textSecondary,
                  ),
                ),
                keyboardType: TextInputType.phone,
              ),
              const SizedBox(height: AppSpacing.xl),

              // ── Account Actions ──
              Align(
                alignment: Alignment.centerLeft,
                child: Row(
                  children: [
                    const Icon(
                      Icons.settings,
                      color: AppColors.highlight,
                      size: 20,
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Text('Account', style: AppTypography.label),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => context.push('/change-password'),
                  icon: const Icon(
                    Icons.lock_outline,
                    color: AppColors.textPrimary,
                  ),
                  label: const Text(
                    'Change Password',
                    style: TextStyle(color: AppColors.textPrimary),
                  ),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: AppColors.border),
                    padding: const EdgeInsets.symmetric(
                      vertical: AppSpacing.md,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () {
                    showDialog(
                      context: context,
                      builder: (ctx) => AlertDialog(
                        title: const Text('Logout'),
                        content: const Text(
                          'Are you sure you want to log out?',
                        ),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(ctx),
                            child: const Text('Cancel'),
                          ),
                          ElevatedButton(
                            onPressed: () {
                              Navigator.pop(ctx);
                              ref.read(authProvider.notifier).logout();
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.error,
                            ),
                            child: const Text('Logout'),
                          ),
                        ],
                      ),
                    );
                  },
                  icon: const Icon(Icons.logout, color: AppColors.error),
                  label: const Text(
                    'Logout',
                    style: TextStyle(color: AppColors.error),
                  ),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: AppColors.error),
                    padding: const EdgeInsets.symmetric(
                      vertical: AppSpacing.md,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.xxl),
            ],
          ),
        ),
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _InfoTile({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 16, color: AppColors.textSecondary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(child: Text(label, style: AppTypography.caption)),
          Text(
            value,
            style: AppTypography.body.copyWith(fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }
}
