import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/providers/auth_provider.dart';

class AdminHubScreen extends ConsumerWidget {
  const AdminHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    if (!auth.isAdmin) {
      return Scaffold(
        appBar: AppBar(title: const Text('Admin')),
        body: const Center(child: Text('Access denied')),
      );
    }

    final sections = <_AdminSection>[
      _AdminSection(
        icon: Icons.people,
        title: 'Members',
        subtitle: 'Manage members and roles',
        route: '/members',
      ),
      _AdminSection(
        icon: Icons.account_balance,
        title: 'Financials',
        subtitle: 'Manage dues, fines, donations',
        route: '/financials',
      ),
      _AdminSection(
        icon: Icons.poll,
        title: 'Polls',
        subtitle: 'Create and manage polls',
        route: '/polls',
      ),
      _AdminSection(
        icon: Icons.event,
        title: 'Events',
        subtitle: 'Manage organization events',
        route: '/events',
      ),
      _AdminSection(
        icon: Icons.folder,
        title: 'Documents',
        subtitle: 'Upload and manage documents',
        route: '/documents',
      ),
      _AdminSection(
        icon: Icons.settings,
        title: 'Organization Settings',
        subtitle: 'Edit org details and preferences',
        route: '/org-settings',
      ),
    ];

    return Scaffold(
      appBar: AppBar(title: const Text('Admin Hub')),
      body: ListView.builder(
        padding: const EdgeInsets.all(AppSpacing.md),
        itemCount: sections.length,
        itemBuilder: (_, i) {
          final s = sections[i];
          return Card(
            margin: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: AppColors.highlightSubtle,
                child: Icon(s.icon, color: AppColors.highlight, size: 22),
              ),
              title: Text(s.title, style: AppTypography.body),
              subtitle: Text(s.subtitle, style: AppTypography.caption),
              trailing: const Icon(
                Icons.chevron_right,
                color: AppColors.textLight,
              ),
              onTap: () {
                if (s.route != null) {
                  context.push(s.route!);
                }
              },
            ),
          );
        },
      ),
    );
  }
}

class _AdminSection {
  final IconData icon;
  final String title;
  final String subtitle;
  final String? route;

  const _AdminSection({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.route,
  });
}
