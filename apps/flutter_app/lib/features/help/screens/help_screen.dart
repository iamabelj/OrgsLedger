import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Help & Support')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          // ── Header ──
          Center(
            child: Column(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: Image.asset(
                    'assets/logo.png',
                    width: 64,
                    height: 64,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const Icon(
                      Icons.help_outline_rounded,
                      size: 64,
                      color: AppColors.highlight,
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                Text('OrgsLedger Support', style: AppTypography.h3),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'We\'re here to help you get the most out of OrgsLedger.',
                  style: AppTypography.bodySmall,
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xl),

          _HelpTile(
            icon: Icons.email_outlined,
            title: 'Email Support',
            subtitle: 'support@orgsledger.com',
            onTap: () => _launchUrl('mailto:support@orgsledger.com'),
          ),
          _HelpTile(
            icon: Icons.language_rounded,
            title: 'Visit Website',
            subtitle: 'app.orgsledger.com',
            onTap: () => _launchUrl('https://app.orgsledger.com'),
          ),
          _HelpTile(
            icon: Icons.article_outlined,
            title: 'Documentation',
            subtitle: 'Guides, FAQs, and tutorials',
            onTap: () => _launchUrl('https://app.orgsledger.com/help'),
          ),
          _HelpTile(
            icon: Icons.bug_report_outlined,
            title: 'Report a Bug',
            subtitle: 'Let us know if something isn\'t working',
            onTap: () => _launchUrl(
              'mailto:support@orgsledger.com?subject=Bug%20Report',
            ),
          ),

          const SizedBox(height: AppSpacing.xl),
          Center(
            child: Text('OrgsLedger v1.0.0', style: AppTypography.caption),
          ),
        ],
      ),
    );
  }

  static Future<void> _launchUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}

class _HelpTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _HelpTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: AppColors.highlightSubtle,
          child: Icon(icon, color: AppColors.highlight, size: 22),
        ),
        title: Text(title, style: AppTypography.body),
        subtitle: Text(subtitle, style: AppTypography.caption),
        trailing: const Icon(Icons.chevron_right, color: AppColors.textLight),
        onTap: onTap,
      ),
    );
  }
}
