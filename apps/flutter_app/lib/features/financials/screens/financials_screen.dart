import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/currency_utils.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';
import '../../../data/models/models.dart';

class FinancialsScreen extends ConsumerStatefulWidget {
  const FinancialsScreen({super.key});
  @override
  ConsumerState<FinancialsScreen> createState() => _FinancialsScreenState();
}

class _FinancialsScreenState extends ConsumerState<FinancialsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabCtrl;
  List<FinancialTransaction> _transactions = [];
  List<Map<String, dynamic>> _donationCampaigns = [];
  bool _loading = true;
  String _currency = 'USD';

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 4, vsync: this);
    _loadData();
  }

  Future<void> _loadData() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) {
      setState(() => _loading = false);
      return;
    }
    try {
      final res = await api.getLedger(orgId);
      // Also load org currency
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
      final raw = res.data['data'] ?? res.data;
      List txnsList;
      if (raw is Map<String, dynamic>) {
        txnsList = (raw['transactions'] ?? []) as List;
      } else if (raw is List) {
        txnsList = raw;
      } else {
        txnsList = [];
      }
      // Also load donation campaigns separately
      try {
        final dcRes = await api.getDonationCampaigns(orgId);
        final dcRaw = dcRes.data['data'] ?? dcRes.data;
        if (dcRaw is List) {
          _donationCampaigns = dcRaw.cast<Map<String, dynamic>>();
        }
      } catch (_) {}
      if (mounted) {
        setState(() {
          _transactions = txnsList
              .map((t) => FinancialTransaction.fromJson(t))
              .toList();
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<FinancialTransaction> _filtered(String type) {
    if (type == 'all') return _transactions;
    return _transactions.where((t) => t.type == type).toList();
  }

  // ── Create Due ────────────────────────────────────────
  void _showCreateDueDialog() {
    final titleCtrl = TextEditingController();
    final amountCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    DateTime dueDate = DateTime.now().add(const Duration(days: 30));

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Create Due'),
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
                  controller: amountCtrl,
                  decoration: InputDecoration(
                    labelText: 'Amount *',
                    prefixText: '${currencySymbol(_currency)} ',
                  ),
                  style: const TextStyle(color: AppColors.textPrimary),
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: descCtrl,
                  decoration: const InputDecoration(labelText: 'Description'),
                  style: const TextStyle(color: AppColors.textPrimary),
                  maxLines: 2,
                ),
                const SizedBox(height: AppSpacing.sm),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    'Due Date: ${dueDate.month}/${dueDate.day}/${dueDate.year}',
                    style: AppTypography.body,
                  ),
                  trailing: const Icon(
                    Icons.calendar_today,
                    color: AppColors.textSecondary,
                  ),
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: ctx,
                      initialDate: dueDate,
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 730)),
                    );
                    if (picked != null) {
                      setDialogState(() => dueDate = picked);
                    }
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
                if (titleCtrl.text.trim().isEmpty ||
                    amountCtrl.text.trim().isEmpty) {
                  return;
                }
                final amount = double.tryParse(amountCtrl.text.trim());
                if (amount == null || amount <= 0) return;
                final orgId = ref.read(authProvider).currentOrgId;
                if (orgId == null) return;
                try {
                  await api.createDue(orgId, {
                    'title': titleCtrl.text.trim(),
                    'description': descCtrl.text.trim(),
                    'amount': amount,
                    'dueDate': dueDate.toUtc().toIso8601String(),
                  });
                  if (ctx.mounted) Navigator.pop(ctx);
                  _loadData();
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
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

  // ── Create Fine ────────────────────────────────────────
  void _showCreateFineDialog() async {
    final amountCtrl = TextEditingController();
    final reasonCtrl = TextEditingController();
    String fineType = 'misconduct';
    String? selectedUserId;
    List<Map<String, dynamic>> members = [];

    // Load members for the dropdown
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    try {
      final res = await api.getMembers(orgId);
      final raw = res.data['data'] ?? res.data;
      if (raw is List) {
        members = raw.cast<Map<String, dynamic>>();
      }
    } catch (_) {}

    if (!mounted) return;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Issue Fine'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: selectedUserId,
                  dropdownColor: AppColors.surface,
                  style: const TextStyle(color: AppColors.textPrimary),
                  decoration: const InputDecoration(
                    labelText: 'Select Member *',
                  ),
                  isExpanded: true,
                  items: members.map((m) {
                    final userId =
                        m['user_id']?.toString() ??
                        m['userId']?.toString() ??
                        m['id']?.toString() ??
                        '';
                    final firstName =
                        m['first_name']?.toString() ??
                        m['firstName']?.toString() ??
                        '';
                    final lastName =
                        m['last_name']?.toString() ??
                        m['lastName']?.toString() ??
                        '';
                    final email = m['email']?.toString() ?? '';
                    final label = firstName.isNotEmpty
                        ? '$firstName $lastName'
                        : email;
                    return DropdownMenuItem(
                      value: userId,
                      child: Text(label, overflow: TextOverflow.ellipsis),
                    );
                  }).toList(),
                  onChanged: (v) {
                    if (v != null) setDialogState(() => selectedUserId = v);
                  },
                ),
                const SizedBox(height: AppSpacing.sm),
                DropdownButtonFormField<String>(
                  initialValue: fineType,
                  dropdownColor: AppColors.surface,
                  style: const TextStyle(color: AppColors.textPrimary),
                  decoration: const InputDecoration(labelText: 'Type'),
                  items: const [
                    DropdownMenuItem(
                      value: 'misconduct',
                      child: Text('Misconduct'),
                    ),
                    DropdownMenuItem(
                      value: 'late_payment',
                      child: Text('Late Payment'),
                    ),
                    DropdownMenuItem(value: 'absence', child: Text('Absence')),
                    DropdownMenuItem(value: 'other', child: Text('Other')),
                  ],
                  onChanged: (v) {
                    if (v != null) setDialogState(() => fineType = v);
                  },
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: amountCtrl,
                  decoration: InputDecoration(
                    labelText: 'Amount *',
                    prefixText: '${currencySymbol(_currency)} ',
                  ),
                  style: const TextStyle(color: AppColors.textPrimary),
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: reasonCtrl,
                  decoration: const InputDecoration(labelText: 'Reason *'),
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
                if (selectedUserId == null ||
                    amountCtrl.text.trim().isEmpty ||
                    reasonCtrl.text.trim().isEmpty) {
                  return;
                }
                final amount = double.tryParse(amountCtrl.text.trim());
                if (amount == null || amount <= 0) return;
                final orgId = ref.read(authProvider).currentOrgId;
                if (orgId == null) return;
                try {
                  await api.createFine(orgId, {
                    'userId': selectedUserId,
                    'type': fineType,
                    'amount': amount,
                    'reason': reasonCtrl.text.trim(),
                  });
                  if (ctx.mounted) Navigator.pop(ctx);
                  _loadData();
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('Failed: $e'),
                        backgroundColor: AppColors.error,
                      ),
                    );
                  }
                }
              },
              child: const Text('Issue'),
            ),
          ],
        ),
      ),
    );
  }

  // ── Create Donation Campaign ──────────────────────────
  void _showCreateDonationDialog() {
    final titleCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    final goalCtrl = TextEditingController();
    DateTime startDate = DateTime.now();

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Create Donation Campaign'),
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
                  maxLines: 2,
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: goalCtrl,
                  decoration: InputDecoration(
                    labelText: 'Goal Amount',
                    prefixText: '${currencySymbol(_currency)} ',
                  ),
                  style: const TextStyle(color: AppColors.textPrimary),
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    'Start: ${startDate.month}/${startDate.day}/${startDate.year}',
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
                      firstDate: DateTime.now().subtract(
                        const Duration(days: 30),
                      ),
                      lastDate: DateTime.now().add(const Duration(days: 730)),
                    );
                    if (picked != null) {
                      setDialogState(() => startDate = picked);
                    }
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
                final body = <String, dynamic>{
                  'title': titleCtrl.text.trim(),
                  'description': descCtrl.text.trim(),
                  'startDate': startDate.toUtc().toIso8601String(),
                };
                final goal = double.tryParse(goalCtrl.text.trim());
                if (goal != null && goal > 0) body['goalAmount'] = goal;
                try {
                  await api.createDonation(orgId, body);
                  if (ctx.mounted) Navigator.pop(ctx);
                  _loadData();
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
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

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isAdmin = ref.watch(authProvider).isAdmin;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.highlight),
          onPressed: () {
            if (Navigator.canPop(context)) {
              context.pop();
            } else {
              context.go('/');
            }
          },
        ),
        title: const Text('Financials'),
        bottom: TabBar(
          controller: _tabCtrl,
          isScrollable: true,
          tabs: const [
            Tab(text: 'All'),
            Tab(text: 'Dues'),
            Tab(text: 'Fines'),
            Tab(text: 'Donations'),
          ],
        ),
      ),
      floatingActionButton: isAdmin
          ? FloatingActionButton(
              onPressed: () => _showAddMenu(),
              backgroundColor: AppColors.highlight,
              child: const Icon(Icons.add, color: AppColors.background),
            )
          : null,
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.highlight),
            )
          : TabBarView(
              controller: _tabCtrl,
              children: [
                _buildTransactionList(_filtered('all')),
                _buildTransactionList(_filtered('due')),
                _buildTransactionList(_filtered('fine')),
                _buildDonationCampaignsList(),
              ],
            ),
    );
  }

  void _showAddMenu() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: AppSpacing.md),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            ListTile(
              leading: const Icon(
                Icons.receipt_long,
                color: AppColors.highlight,
              ),
              title: const Text('Create Due'),
              subtitle: const Text('Set up a new membership due'),
              onTap: () {
                Navigator.pop(ctx);
                _showCreateDueDialog();
              },
            ),
            ListTile(
              leading: const Icon(Icons.gavel, color: AppColors.warning),
              title: const Text('Issue Fine'),
              subtitle: const Text('Fine a member'),
              onTap: () {
                Navigator.pop(ctx);
                _showCreateFineDialog();
              },
            ),
            ListTile(
              leading: const Icon(
                Icons.volunteer_activism,
                color: AppColors.success,
              ),
              title: const Text('Donation Campaign'),
              subtitle: const Text('Start a new campaign'),
              onTap: () {
                Navigator.pop(ctx);
                _showCreateDonationDialog();
              },
            ),
            const SizedBox(height: AppSpacing.lg),
          ],
        ),
      ),
    );
  }

  Widget _buildDonationCampaignsList() {
    if (_donationCampaigns.isEmpty) {
      return RefreshIndicator(
        onRefresh: _loadData,
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
                      Icons.volunteer_activism,
                      size: 64,
                      color: AppColors.textLight,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      'No donation campaigns',
                      style: AppTypography.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView.builder(
        padding: const EdgeInsets.all(AppSpacing.md),
        itemCount: _donationCampaigns.length,
        itemBuilder: (_, i) {
          final dc = _donationCampaigns[i];
          final title = dc['title']?.toString() ?? 'Untitled Campaign';
          final desc = dc['description']?.toString() ?? '';
          final goalAmount = dc['goal_amount'] ?? dc['goalAmount'];
          final totalRaised = dc['total_raised'] ?? dc['totalRaised'] ?? 0;
          final donationCount =
              dc['donation_count'] ?? dc['donationCount'] ?? 0;
          final status = dc['status']?.toString() ?? 'active';
          final isActive = status == 'active';

          return Card(
            margin: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: isActive
                    ? AppColors.success.withValues(alpha: 0.15)
                    : AppColors.textLight.withValues(alpha: 0.15),
                child: Icon(
                  Icons.volunteer_activism,
                  color: isActive ? AppColors.success : AppColors.textLight,
                  size: 20,
                ),
              ),
              title: Text(title, style: AppTypography.body),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (desc.isNotEmpty)
                    Text(
                      desc,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTypography.caption,
                    ),
                  Text(
                    '$donationCount donation${donationCount == 1 ? '' : 's'} · '
                    'Raised: ${formatCurrency((totalRaised is num) ? totalRaised.toDouble() : double.tryParse(totalRaised.toString()) ?? 0, currency: _currency)}',
                    style: AppTypography.caption.copyWith(
                      color: AppColors.highlight,
                    ),
                  ),
                ],
              ),
              trailing: goalAmount != null
                  ? Text(
                      formatCurrency(
                        (goalAmount is num)
                            ? goalAmount.toDouble()
                            : double.tryParse(goalAmount.toString()) ?? 0,
                        currency: _currency,
                      ),
                      style: const TextStyle(
                        color: AppColors.highlight,
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    )
                  : null,
              isThreeLine: desc.isNotEmpty,
            ),
          );
        },
      ),
    );
  }

  Widget _buildTransactionList(List<FinancialTransaction> txns) {
    if (txns.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.account_balance_outlined,
              size: 64,
              color: AppColors.textLight,
            ),
            const SizedBox(height: AppSpacing.md),
            Text('No transactions', style: AppTypography.bodySmall),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView.builder(
        padding: const EdgeInsets.all(AppSpacing.md),
        itemCount: txns.length,
        itemBuilder: (_, i) {
          final t = txns[i];
          final isPaid = t.status == 'paid' || t.status == 'completed';
          return Card(
            margin: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: isPaid
                    ? AppColors.success.withValues(alpha: 0.15)
                    : AppColors.warning.withValues(alpha: 0.15),
                child: Icon(
                  isPaid ? Icons.check_circle : Icons.pending,
                  color: isPaid ? AppColors.success : AppColors.warning,
                  size: 20,
                ),
              ),
              title: Text(
                t.description.isNotEmpty ? t.description : t.type,
                style: AppTypography.body,
              ),
              subtitle: Text(t.status, style: AppTypography.caption),
              trailing: Text(
                formatCurrency(t.amount, currency: _currency),
                style: TextStyle(
                  color: isPaid ? AppColors.success : AppColors.highlight,
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
