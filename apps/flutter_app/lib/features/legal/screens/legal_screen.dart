import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

class LegalScreen extends StatelessWidget {
  const LegalScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final items = <_LegalItem>[
      _LegalItem(
        icon: Icons.description,
        title: 'Terms of Service',
        url: 'https://app.orgsledger.com/legal/terms',
      ),
      _LegalItem(
        icon: Icons.privacy_tip,
        title: 'Privacy Policy',
        url: 'https://app.orgsledger.com/legal/privacy',
      ),
      _LegalItem(
        icon: Icons.security,
        title: 'Data Processing Agreement',
        url: 'https://app.orgsledger.com/legal/dpa',
      ),
      _LegalItem(
        icon: Icons.cookie,
        title: 'Cookie Policy',
        url: 'https://app.orgsledger.com/legal/cookies',
      ),
    ];

    return Scaffold(
      appBar: AppBar(title: const Text('Legal')),
      body: ListView.builder(
        padding: const EdgeInsets.all(AppSpacing.md),
        itemCount: items.length,
        itemBuilder: (_, i) {
          final item = items[i];
          return Card(
            margin: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: ListTile(
              leading: Icon(item.icon, color: AppColors.highlight),
              title: Text(item.title, style: AppTypography.body),
              trailing: const Icon(
                Icons.open_in_new,
                size: 18,
                color: AppColors.textSecondary,
              ),
              onTap: () => launchUrl(
                Uri.parse(item.url),
                mode: LaunchMode.externalApplication,
              ),
            ),
          );
        },
      ),
    );
  }
}

class _LegalItem {
  final IconData icon;
  final String title;
  final String url;
  const _LegalItem({
    required this.icon,
    required this.title,
    required this.url,
  });
}
