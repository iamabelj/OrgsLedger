import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/currency_utils.dart';
import '../../../core/widgets/app_shell.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});
  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  Map<String, dynamic> _financialSummary = {};
  bool _loading = true;
  String? _lastOrgId;
  String _currency = 'USD';
  String? _error;

  @override
  void initState() {
    super.initState();
    // Defer to didChangeDependencies so ref.listen works
  }

  @override
  void dispose() {
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Watch for auth state changes and reload when orgId becomes available
    final auth = ref.read(authProvider);
    final orgId = auth.currentOrgId;
    if (orgId != null && orgId != _lastOrgId) {
      _lastOrgId = orgId;
      _loadDashboard();
    } else if (orgId == null && !auth.isLoading && _loading) {
      setState(() => _loading = false);
    }
  }

  Future<void> _loadDashboard() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) {
      setState(() => _loading = false);
      return;
    }
    if (!_loading) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final results = await Future.wait([api.getLedger(orgId)]);

      // Load org currency
      try {
        final orgRes = await api.getOrganization(orgId);
        final orgData = orgRes.data['data'] ?? orgRes.data;
        if (orgData is Map<String, dynamic>) {
          final settings = orgData['settings'] is Map<String, dynamic>
              ? orgData['settings'] as Map<String, dynamic>
              : <String, dynamic>{};
          _currency =
              settings['currency']?.toString() ??
              orgData['billing_currency']?.toString() ??
              orgData['currency']?.toString() ??
              'USD';
        }
      } catch (_) {}

      // Parse ledger — API returns { data: { transactions: [...], summary: { ... } } }
      final ledgerRaw = results[0].data;
      final ledgerData = ledgerRaw['data'] ?? ledgerRaw ?? {};

      if (mounted) {
        setState(() {
          // Extract the summary sub-object from ledger response
          if (ledgerData is Map<String, dynamic>) {
            _financialSummary =
                (ledgerData['summary'] as Map<String, dynamic>?) ?? ledgerData;
          } else {
            _financialSummary = {};
          }
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Could not load dashboard. Pull to refresh.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);

    // React to auth state changes — reload if org changed
    final newOrgId = auth.currentOrgId;
    if (newOrgId != null && newOrgId != _lastOrgId) {
      _lastOrgId = newOrgId;
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadDashboard());
    }

    final width = MediaQuery.of(context).size.width;
    final isDesktop = width >= 1024;
    final maxWidth = isDesktop ? 900.0 : double.infinity;

    return Scaffold(
      appBar: AppBar(
        leading: isDesktop
            ? null
            : IconButton(
                icon: const Icon(Icons.menu, color: AppColors.highlight),
                onPressed: () => AppShell.openDrawer(),
              ),
        title: const Text('Dashboard'),
        actions: [
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () => context.push('/notifications'),
          ),
        ],
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.highlight),
            )
          : _error != null
          ? RefreshIndicator(
              onRefresh: _loadDashboard,
              color: AppColors.highlight,
              child: ListView(
                children: [
                  SizedBox(
                    height: MediaQuery.of(context).size.height * 0.5,
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.cloud_off,
                            size: 64,
                            color: AppColors.textLight,
                          ),
                          const SizedBox(height: AppSpacing.md),
                          Text(
                            _error!,
                            style: AppTypography.body.copyWith(
                              color: AppColors.textSecondary,
                            ),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          ElevatedButton.icon(
                            onPressed: _loadDashboard,
                            icon: const Icon(Icons.refresh),
                            label: const Text('Retry'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _loadDashboard,
              color: AppColors.highlight,
              child: ListView(
                padding: EdgeInsets.symmetric(
                  horizontal: isDesktop
                      ? (width - maxWidth) / 2
                      : AppSpacing.md,
                  vertical: AppSpacing.md,
                ),
                children: [
                  // ── Welcome ──
                  Text(
                    'Welcome, ${auth.user?.firstName ?? 'User'}',
                    style: AppTypography.h3,
                  ),
                  if (auth.currentMembership != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: _OrgSwitcherPill(auth: auth, ref: ref),
                    ),
                  const SizedBox(height: AppSpacing.lg),

                  // ── Quick Stats ──
                  _buildQuickStats(),
                  const SizedBox(height: AppSpacing.lg),

                  // ── Quick Actions ──
                  _SectionHeader(title: 'Quick Actions'),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: [
                      _QuickAction(
                        icon: Icons.chat_bubble,
                        label: 'Chat',
                        onTap: () => context.go('/chat'),
                      ),
                      _QuickAction(
                        icon: Icons.poll,
                        label: 'Polls',
                        onTap: () => context.push('/polls'),
                      ),
                      _QuickAction(
                        icon: Icons.folder,
                        label: 'Documents',
                        onTap: () => context.push('/documents'),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xxl),
                ],
              ),
            ),
    );
  }

  Widget _buildQuickStats() {
    // API returns: { total_dues_collected, total_fines_collected, total_donations, total_refunds, grand_total }
    final totalDues =
        _financialSummary['total_dues_collected'] ??
        _financialSummary['totalDues'] ??
        _financialSummary['grand_total'] ??
        0;
    final totalPaid =
        _financialSummary['total_donations'] ??
        _financialSummary['totalPaid'] ??
        0;
    return Row(
      children: [
        Expanded(
          child: _StatCard(
            icon: Icons.account_balance_wallet,
            label: 'Total Dues',
            value: '${currencySymbol(_currency)}$totalDues',
            color: AppColors.warning,
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: _StatCard(
            icon: Icons.check_circle,
            label: 'Total Paid',
            value: '${currencySymbol(_currency)}$totalPaid',
            color: AppColors.success,
          ),
        ),
      ],
    );
  }
}

// ── Reusable Widgets ────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Text(title, style: AppTypography.h4),
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;
  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(height: AppSpacing.sm),
          Text(value, style: AppTypography.h4.copyWith(color: color)),
          Text(label, style: AppTypography.caption),
        ],
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: Container(
        width: 100,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          children: [
            Icon(icon, color: AppColors.highlight, size: 28),
            const SizedBox(height: AppSpacing.xs),
            Text(
              label,
              style: AppTypography.caption.copyWith(
                color: AppColors.textPrimary,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

/// Tappable org-switcher pill matching desktop design.
class _OrgSwitcherPill extends StatelessWidget {
  final AuthState auth;
  final WidgetRef ref;
  const _OrgSwitcherPill({required this.auth, required this.ref});

  @override
  Widget build(BuildContext context) {
    final hasMultiple = auth.user != null && auth.user!.memberships.length > 1;

    return GestureDetector(
      onTap: hasMultiple ? () => _showOrgSwitcher(context) : null,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: AppColors.highlightSubtle,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.shield_rounded,
              color: AppColors.highlight,
              size: 16,
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                auth.currentMembership?.orgName ?? '',
                style: const TextStyle(
                  color: AppColors.highlight,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (auth.currentMembership?.role != null) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.highlight.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  _formatRole(auth.currentMembership!.role),
                  style: const TextStyle(
                    color: AppColors.highlight,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
            if (hasMultiple) ...[
              const SizedBox(width: 4),
              const Icon(
                Icons.keyboard_arrow_down_rounded,
                color: AppColors.highlight,
                size: 18,
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatRole(String role) {
    return role
        .replaceAll('_', ' ')
        .split(' ')
        .map((w) {
          if (w.isEmpty) return w;
          return w[0].toUpperCase() + w.substring(1);
        })
        .join(' ');
  }

  void _showOrgSwitcher(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text(
                'Switch Organization',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            ...auth.user!.memberships.map((m) {
              final isActive = m.organizationId == auth.currentOrgId;
              return ListTile(
                leading: CircleAvatar(
                  backgroundColor: isActive
                      ? AppColors.highlightSubtle
                      : AppColors.surfaceAlt,
                  child: Icon(
                    Icons.shield_rounded,
                    color: isActive
                        ? AppColors.highlight
                        : AppColors.textSecondary,
                    size: 20,
                  ),
                ),
                title: Text(
                  m.orgName,
                  style: TextStyle(
                    color: isActive
                        ? AppColors.highlight
                        : AppColors.textPrimary,
                    fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
                subtitle: Text(
                  _formatRole(m.role),
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                  ),
                ),
                trailing: isActive
                    ? const Icon(
                        Icons.check_circle_rounded,
                        color: AppColors.highlight,
                        size: 22,
                      )
                    : null,
                onTap: () {
                  ref.read(authProvider.notifier).switchOrg(m.organizationId);
                  Navigator.pop(context);
                },
              );
            }),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
