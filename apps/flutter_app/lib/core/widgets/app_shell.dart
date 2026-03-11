import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../../data/providers/auth_provider.dart';

/// Responsive app shell: side drawer on desktop, bottom nav + drawer on mobile/tablet.
class AppShell extends ConsumerStatefulWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  /// Global key to open/close the mobile drawer from any screen
  static final scaffoldKey = GlobalKey<ScaffoldState>();

  /// Open the navigation drawer from any child screen
  static void openDrawer() {
    scaffoldKey.currentState?.openDrawer();
  }

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _selectedIndex = 0;

  static const _tabs = [
    _TabItem(icon: Icons.home_rounded, label: 'Home', path: '/'),
    _TabItem(icon: Icons.chat_bubble_rounded, label: 'Chat', path: '/chat'),
    _TabItem(
      icon: Icons.account_balance_wallet_rounded,
      label: 'Financials',
      path: '/financials',
    ),
    _TabItem(icon: Icons.person_rounded, label: 'Profile', path: '/profile'),
  ];

  void _onTabSelected(int index) {
    setState(() => _selectedIndex = index);
    context.go(_tabs[index].path);
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    final isDesktop = width >= 1024;
    final auth = ref.watch(authProvider);

    // Update selected index based on current route
    final location = GoRouterState.of(context).matchedLocation;
    for (var i = 0; i < _tabs.length; i++) {
      if (location == _tabs[i].path ||
          (i > 0 && location.startsWith(_tabs[i].path))) {
        if (_selectedIndex != i) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) setState(() => _selectedIndex = i);
          });
        }
        break;
      }
    }

    if (isDesktop) {
      return Scaffold(
        body: Row(
          children: [
            // ── Side Navigation Drawer ──
            _SideDrawer(
              selectedIndex: _selectedIndex,
              onSelect: _onTabSelected,
              isAdmin: auth.isAdmin,
              orgName: auth.currentMembership?.orgName,
              userName: auth.user?.displayName,
              onNavigate: (path) => context.push(path),
              onLogout: () => ref.read(authProvider.notifier).logout(),
            ),
            // ── Content ──
            Expanded(child: widget.child),
          ],
        ),
      );
    }

    // ── Mobile / Tablet: bottom nav + drawer via hamburger ──
    return Scaffold(
      key: AppShell.scaffoldKey,
      drawer: Drawer(
        backgroundColor: AppColors.surface,
        child: _DrawerContent(
          selectedIndex: _selectedIndex,
          onSelect: (i) {
            Navigator.of(context).pop(); // Close drawer
            _onTabSelected(i);
          },
          isAdmin: auth.isAdmin,
          orgName: auth.currentMembership?.orgName,
          userName: auth.user?.displayName,
          onNavigate: (path) {
            Navigator.of(context).pop(); // Close drawer
            context.push(path);
          },
          onLogout: () {
            Navigator.of(context).pop(); // Close drawer
            ref.read(authProvider.notifier).logout();
          },
        ),
      ),
      body: widget.child,
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _selectedIndex,
        onTap: _onTabSelected,
        items: _tabs
            .map(
              (t) =>
                  BottomNavigationBarItem(icon: Icon(t.icon), label: t.label),
            )
            .toList(),
      ),
    );
  }
}

class _TabItem {
  final IconData icon;
  final String label;
  final String path;
  const _TabItem({required this.icon, required this.label, required this.path});
}

// ── Desktop Side Drawer ──────────────────────────────────

class _SideDrawer extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onSelect;
  final bool isAdmin;
  final String? orgName;
  final String? userName;
  final ValueChanged<String> onNavigate;
  final VoidCallback onLogout;

  const _SideDrawer({
    required this.selectedIndex,
    required this.onSelect,
    required this.isAdmin,
    this.orgName,
    this.userName,
    required this.onNavigate,
    required this.onLogout,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 240,
      color: AppColors.surface,
      child: _DrawerContent(
        selectedIndex: selectedIndex,
        onSelect: onSelect,
        isAdmin: isAdmin,
        orgName: orgName,
        userName: userName,
        onNavigate: onNavigate,
        onLogout: onLogout,
      ),
    );
  }
}

class _DrawerContent extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onSelect;
  final bool isAdmin;
  final String? orgName;
  final String? userName;
  final ValueChanged<String> onNavigate;
  final VoidCallback onLogout;

  const _DrawerContent({
    required this.selectedIndex,
    required this.onSelect,
    required this.isAdmin,
    this.orgName,
    this.userName,
    required this.onNavigate,
    required this.onLogout,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        children: [
          // ── Header ──
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.asset(
                    'assets/logo.png',
                    width: 36,
                    height: 36,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: AppColors.highlightSubtle,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(
                        Icons.shield_rounded,
                        color: AppColors.highlight,
                        size: 20,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        orgName ?? 'OrgsLedger',
                        style: const TextStyle(
                          color: AppColors.highlight,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (userName != null)
                        Text(
                          userName!,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 12,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),

          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                // ── MAIN ──
                _GroupLabel(label: 'MAIN'),
                ...List.generate(_AppShellState._tabs.length, (i) {
                  final tab = _AppShellState._tabs[i];
                  final isActive = selectedIndex == i;
                  return _DrawerTile(
                    icon: tab.icon,
                    label: tab.label,
                    isActive: isActive,
                    onTap: () => onSelect(i),
                  );
                }),

                // ── COMMUNITY ──
                _GroupLabel(label: 'COMMUNITY'),
                _DrawerTile(
                  icon: Icons.people_alt_rounded,
                  label: 'Members',
                  onTap: () => onNavigate('/members'),
                ),
                _DrawerTile(
                  icon: Icons.campaign_rounded,
                  label: 'Announcements',
                  onTap: () => onNavigate('/announcements'),
                ),
                _DrawerTile(
                  icon: Icons.event_rounded,
                  label: 'Events',
                  onTap: () => onNavigate('/events'),
                ),
                _DrawerTile(
                  icon: Icons.poll_rounded,
                  label: 'Polls',
                  onTap: () => onNavigate('/polls'),
                ),
                _DrawerTile(
                  icon: Icons.folder_rounded,
                  label: 'Documents',
                  onTap: () => onNavigate('/documents'),
                ),
                _DrawerTile(
                  icon: Icons.notifications_rounded,
                  label: 'Notifications',
                  onTap: () => onNavigate('/notifications'),
                ),

                // ── ADMINISTRATION (admin/exec only) ──
                if (isAdmin) ...[
                  _GroupLabel(label: 'ADMINISTRATION'),
                  _DrawerTile(
                    icon: Icons.admin_panel_settings_rounded,
                    label: 'Admin Hub',
                    onTap: () => onNavigate('/admin'),
                  ),
                ],

                // ── LEGAL ──
                _GroupLabel(label: 'LEGAL'),
                _DrawerTile(
                  icon: Icons.gavel_rounded,
                  label: 'Legal',
                  onTap: () => onNavigate('/legal'),
                ),

                const SizedBox(height: AppSpacing.sm),
                const Divider(height: 1),
                _DrawerTile(
                  icon: Icons.help_outline_rounded,
                  label: 'Help & Support',
                  onTap: () => onNavigate('/help'),
                ),
                _DrawerTile(
                  icon: Icons.logout_rounded,
                  label: 'Log Out',
                  isDestructive: true,
                  onTap: onLogout,
                ),
                const SizedBox(height: AppSpacing.sm),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DrawerTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isActive;
  final bool isDestructive;
  final VoidCallback onTap;

  const _DrawerTile({
    required this.icon,
    required this.label,
    this.isActive = false,
    this.isDestructive = false,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = isDestructive
        ? AppColors.error
        : isActive
        ? AppColors.highlight
        : AppColors.textSecondary;

    return ListTile(
      dense: true,
      leading: Icon(icon, color: color, size: 20),
      title: Text(
        label,
        style: TextStyle(
          color: color,
          fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
          fontSize: 14,
        ),
      ),
      selected: isActive,
      selectedTileColor: AppColors.highlightSubtle,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      onTap: onTap,
    );
  }
}

class _GroupLabel extends StatelessWidget {
  final String label;
  const _GroupLabel({required this.label});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(
        label,
        style: const TextStyle(
          color: AppColors.textLight,
          fontSize: 11,
          fontWeight: FontWeight.w600,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}
