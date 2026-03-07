import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';

class OrgSettingsScreen extends ConsumerStatefulWidget {
  const OrgSettingsScreen({super.key});
  @override
  ConsumerState<OrgSettingsScreen> createState() => _OrgSettingsScreenState();
}

class _OrgSettingsScreenState extends ConsumerState<OrgSettingsScreen> {
  final _nameCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _slugCtrl = TextEditingController();
  String _currency = 'USD';
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) {
      setState(() => _loading = false);
      return;
    }
    try {
      final res = await api.getOrganization(orgId);
      final data = res.data['data'] ?? res.data;
      if (data is Map<String, dynamic> && mounted) {
        final settings = data['settings'] is Map<String, dynamic>
            ? data['settings'] as Map<String, dynamic>
            : <String, dynamic>{};
        setState(() {
          _nameCtrl.text = data['name']?.toString() ?? '';
          _slugCtrl.text = data['slug']?.toString() ?? '';
          _descCtrl.text =
              settings['description']?.toString() ??
              data['description']?.toString() ??
              '';
          _currency =
              settings['currency']?.toString() ??
              data['billing_currency']?.toString() ??
              data['currency']?.toString() ??
              'USD';
          _loading = false;
        });
      } else {
        if (mounted) setState(() => _loading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    setState(() => _saving = true);

    try {
      await api.updateOrgSettings(orgId, {
        'name': _nameCtrl.text.trim(),
        'settings': {
          'description': _descCtrl.text.trim(),
          'slug': _slugCtrl.text.trim(),
          'currency': _currency,
          'allowPublicJoin': false,
        },
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Settings saved'),
            backgroundColor: AppColors.success,
          ),
        );
        // Refresh auth to pick up name changes
        ref.read(authProvider.notifier).loadUser();
      }
    } catch (e) {
      String msg = 'Failed to save settings';
      if (e is DioException && e.response?.data is Map) {
        msg = e.response!.data['error']?.toString() ?? msg;
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: AppColors.error),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _descCtrl.dispose();
    _slugCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Organization Settings'),
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
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.highlight),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Organization Name', style: AppTypography.label),
                  const SizedBox(height: AppSpacing.xs),
                  TextField(
                    controller: _nameCtrl,
                    style: const TextStyle(color: AppColors.textPrimary),
                    decoration: const InputDecoration(
                      hintText: 'e.g. My Organization',
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text('Slug (URL identifier)', style: AppTypography.label),
                  const SizedBox(height: AppSpacing.xs),
                  TextField(
                    controller: _slugCtrl,
                    style: const TextStyle(color: AppColors.textPrimary),
                    decoration: const InputDecoration(
                      hintText: 'e.g. my-organization',
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text('Description', style: AppTypography.label),
                  const SizedBox(height: AppSpacing.xs),
                  TextField(
                    controller: _descCtrl,
                    style: const TextStyle(color: AppColors.textPrimary),
                    maxLines: 4,
                    decoration: const InputDecoration(
                      hintText: 'Describe your organization...',
                      alignLabelWithHint: true,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text('Currency', style: AppTypography.label),
                  const SizedBox(height: AppSpacing.xs),
                  DropdownButtonFormField<String>(
                    value: _currency,
                    dropdownColor: AppColors.surface,
                    style: const TextStyle(color: AppColors.textPrimary),
                    decoration: const InputDecoration(),
                    items: const [
                      DropdownMenuItem(
                        value: 'USD',
                        child: Text('USD - US Dollar'),
                      ),
                      DropdownMenuItem(value: 'EUR', child: Text('EUR - Euro')),
                      DropdownMenuItem(
                        value: 'GBP',
                        child: Text('GBP - British Pound'),
                      ),
                      DropdownMenuItem(
                        value: 'NGN',
                        child: Text('NGN - Nigerian Naira'),
                      ),
                      DropdownMenuItem(
                        value: 'GHS',
                        child: Text('GHS - Ghana Cedi'),
                      ),
                      DropdownMenuItem(
                        value: 'KES',
                        child: Text('KES - Kenyan Shilling'),
                      ),
                      DropdownMenuItem(
                        value: 'ZAR',
                        child: Text('ZAR - South African Rand'),
                      ),
                      DropdownMenuItem(
                        value: 'CAD',
                        child: Text('CAD - Canadian Dollar'),
                      ),
                      DropdownMenuItem(
                        value: 'AUD',
                        child: Text('AUD - Australian Dollar'),
                      ),
                      DropdownMenuItem(
                        value: 'INR',
                        child: Text('INR - Indian Rupee'),
                      ),
                    ],
                    onChanged: (v) {
                      if (v != null) setState(() => _currency = v);
                    },
                  ),
                ],
              ),
            ),
    );
  }
}
