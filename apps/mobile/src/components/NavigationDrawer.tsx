// ============================================================
// OrgsLedger — Premium Responsive Navigation Sidebar
// ============================================================
// Features: Collapsible desktop sidebar (full ↔ icon-only),
//           Overlay drawer on mobile, premium royal styling,
//           grouped navigation with badges.

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Pressable,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useAuthStore } from '../stores/auth.store';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../theme';
import { useDrawer, DRAWER_WIDTH, DRAWER_COLLAPSED_WIDTH } from '../contexts/DrawerContext';
import { LOGO } from '../logo';
import { showAlert } from '../utils/alert';

interface NavItem {
  label: string;
  icon: string;
  path: string;
}

// ── Navigation Groups ───────────────────────────────────
const mainItems: NavItem[] = [
  { label: 'Dashboard', icon: 'grid-outline', path: '/(tabs)/home' },
  { label: 'Chat', icon: 'chatbubbles-outline', path: '/(tabs)/chat' },
  { label: 'Meetings', icon: 'videocam-outline', path: '/(tabs)/meetings' },
  { label: 'Financials', icon: 'wallet-outline', path: '/(tabs)/financials' },
];

const communityItems: NavItem[] = [
  { label: 'Members', icon: 'people-outline', path: '/members' },
  { label: 'Announcements', icon: 'megaphone-outline', path: '/announcements' },
  { label: 'Events', icon: 'calendar-outline', path: '/events' },
  { label: 'Polls', icon: 'bar-chart-outline', path: '/polls' },
  { label: 'Documents', icon: 'folder-open-outline', path: '/documents' },
];

const adminItems: NavItem[] = [
  { label: 'Manage Members', icon: 'people-circle-outline', path: '/admin/members' },
  { label: 'Invite Links', icon: 'link-outline', path: '/admin/members' },
  { label: 'Create Due', icon: 'card-outline', path: '/admin/create-due' },
  { label: 'Create Fine', icon: 'alert-circle-outline', path: '/admin/create-fine' },
  { label: 'Campaigns', icon: 'heart-outline', path: '/admin/create-campaign' },
  { label: 'Expenses', icon: 'receipt-outline', path: '/admin/expenses' },
  { label: 'Committees', icon: 'git-branch-outline', path: '/admin/committees' },
  { label: 'Reports', icon: 'stats-chart-outline', path: '/admin/reports' },
  { label: 'Settings', icon: 'cog-outline', path: '/admin/settings' },
  { label: 'Analytics', icon: 'analytics-outline', path: '/admin/analytics' },
  { label: 'Bank Transfers', icon: 'swap-horizontal-outline', path: '/admin/bank-transfers' },
  { label: 'Pay Config', icon: 'card-outline', path: '/admin/payment-methods' },
  { label: 'Subscription', icon: 'ribbon-outline', path: '/admin/subscription' },
  { label: 'Compliance', icon: 'shield-checkmark-outline', path: '/admin/compliance' },
  { label: 'AI Plans', icon: 'sparkles-outline', path: '/admin/plans' },
];

const executiveItems: NavItem[] = [
  { label: 'Manage Members', icon: 'people-circle-outline', path: '/admin/members' },
  { label: 'Invite Links', icon: 'link-outline', path: '/admin/members' },
  { label: 'Create Due', icon: 'card-outline', path: '/admin/create-due' },
  { label: 'Campaigns', icon: 'heart-outline', path: '/admin/create-campaign' },
  { label: 'Expenses', icon: 'receipt-outline', path: '/admin/expenses' },
  { label: 'Committees', icon: 'git-branch-outline', path: '/admin/committees' },
  { label: 'Reports', icon: 'stats-chart-outline', path: '/admin/reports' },
];

// Developer-only items — NOT visible to super_admin
const developerItems: NavItem[] = [
  { label: 'Developer Console', icon: 'code-slash-outline', path: '/admin/developer-console' },
];

const legalItems: NavItem[] = [
  { label: 'Terms of Service', icon: 'document-text-outline', path: '/legal/terms' },
  { label: 'Privacy Policy', icon: 'shield-checkmark-outline', path: '/legal/privacy' },
  { label: 'Data Processing', icon: 'server-outline', path: '/legal/dpa' },
  { label: 'Acceptable Use', icon: 'hand-left-outline', path: '/legal/acceptable-use' },
];

const API_BASE = __DEV__ ? 'http://localhost:3000' : 'https://app.orgsledger.com';

// Inject CSS keyframes on web for smooth animations
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'orgsledger-drawer-animations';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes drawerSlideIn {
        from { transform: translateX(-100%); opacity: 0.5; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes overlayFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes pageContentFadeIn {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }
}

export function NavigationDrawer() {
  const pathname = usePathname();
  const { isOpen, isCollapsed, close, toggle, isDesktop } = useDrawer();
  const memberships = useAuthStore((s) => s.memberships);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const currentMembership = memberships.find((m) => m.organization_id === currentOrgId);
  const userRole = currentMembership?.role || 'member';
  const globalRole = user?.globalRole;
  const isDeveloper = globalRole === 'developer';
  const isSuperAdmin = globalRole === 'super_admin' || isDeveloper;
  const isOrgAdmin = userRole === 'org_admin' || isSuperAdmin;
  const isExecutive = userRole === 'executive';
  const isAdmin = isOrgAdmin || isExecutive;
  const drawerAdminItems = isOrgAdmin ? adminItems : executiveItems;

  const shouldShow = isOpen && isAuthenticated;

  const handleNavigation = (path: string) => {
    router.push(path as any);
    if (!isDesktop) close();
  };

  const handleLogout = async () => {
    showAlert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  if (!shouldShow) return null;

  const currentWidth = isCollapsed ? DRAWER_COLLAPSED_WIDTH : DRAWER_WIDTH;

  const avatarUrl = user?.avatarUrl
    ? (user.avatarUrl.startsWith('http') ? user.avatarUrl : `${API_BASE}${user.avatarUrl}`)
    : null;

  const initials = `${(user?.firstName || '?')[0]}${(user?.lastName || '?')[0]}`.toUpperCase();

  // ── Render a single nav item ─────────────────────────
  const renderNavItem = (item: NavItem, idx: number) => {
    const isActive = pathname === item.path || pathname?.startsWith(item.path + '/');
    const exactActive = pathname === item.path;

    return (
      <TouchableOpacity
        key={`${item.path}-${idx}`}
        style={[
          styles.navItem,
          isCollapsed && styles.navItemCollapsed,
          (exactActive || isActive) && styles.navItemActive,
        ]}
        onPress={() => handleNavigation(item.path)}
        activeOpacity={0.7}
      >
        <View style={[
          styles.navIconWrap,
          (exactActive || isActive) && styles.navIconWrapActive,
        ]}>
          <Ionicons
            name={(exactActive || isActive) ? (item.icon.replace('-outline', '') as any) : (item.icon as any)}
            size={20}
            color={(exactActive || isActive) ? Colors.highlight : Colors.textLight}
          />
        </View>
        {!isCollapsed && (
          <Text
            style={[styles.navItemText, (exactActive || isActive) && styles.navItemTextActive]}
            numberOfLines={1}
          >
            {item.label}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  // ── Render a nav group ───────────────────────────────
  const renderGroup = (title: string, items: NavItem[]) => (
    <View style={styles.navGroup} key={title}>
      {!isCollapsed ? (
        <Text style={styles.navGroupTitle}>{title}</Text>
      ) : (
        <View style={styles.navGroupDivider} />
      )}
      {items.map(renderNavItem)}
    </View>
  );

  const drawer = (
    <View style={[
      styles.drawer,
      { width: currentWidth },
      isDesktop && styles.drawerDesktop,
    ]}>
      {/* ── Brand Header ──────────────────────────────── */}
      <View style={[styles.header, isCollapsed && styles.headerCollapsed]}>
        {!isCollapsed ? (
          <View style={styles.brandRow}>
            <View style={styles.logoWrap}>
              <Image source={LOGO} style={styles.logoImg} resizeMode="contain" />
            </View>
            <Text style={styles.appName}>OrgsLedger</Text>
            {isDesktop && (
              <TouchableOpacity
                style={styles.collapseBtn}
                onPress={toggle}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="chevron-back" size={18} color={Colors.textLight} />
              </TouchableOpacity>
            )}
            {!isDesktop && (
              <TouchableOpacity
                style={styles.closeBtnMobile}
                onPress={close}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={Colors.textLight} />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <TouchableOpacity
            style={styles.collapsedLogoBtn}
            onPress={toggle}
          >
            <Image source={LOGO} style={{ width: 24, height: 24 }} resizeMode="contain" />
          </TouchableOpacity>
        )}
      </View>

      {/* ── User Profile Card ─────────────────────────── */}
      {user && (
        <TouchableOpacity
          style={[styles.userCard, isCollapsed && styles.userCardCollapsed]}
          onPress={() => handleNavigation('/(tabs)/profile')}
          activeOpacity={0.8}
        >
          <View style={[styles.userAvatar, isCollapsed && styles.userAvatarCollapsed]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.userAvatarImage} />
            ) : (
              <Text style={styles.userAvatarText}>{initials}</Text>
            )}
            <View style={styles.onlineDot} />
          </View>
          {!isCollapsed && (
            <View style={styles.userMeta}>
              <Text style={styles.userName} numberOfLines={1}>
                {user.firstName} {user.lastName}
              </Text>
              <Text style={styles.userRole} numberOfLines={1}>
                {userRole.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* ── Navigation Groups ─────────────────────────── */}
      <ScrollView
        style={styles.navScroll}
        contentContainerStyle={styles.navScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderGroup('MAIN', mainItems)}
        {renderGroup('COMMUNITY', communityItems)}

        {isAdmin && renderGroup(
          isOrgAdmin ? 'ADMINISTRATION' : 'MANAGEMENT',
          drawerAdminItems,
        )}

        {isDeveloper && renderGroup('PLATFORM', developerItems)}

        {renderGroup('LEGAL', legalItems)}
      </ScrollView>

      {/* ── Footer: Help & Logout ─────────────────────── */}
      <View style={[styles.footer, isCollapsed && styles.footerCollapsed]}>
        <TouchableOpacity
          style={[styles.footerBtn, isCollapsed && styles.footerBtnCollapsed]}
          onPress={() => handleNavigation('/help')}
          activeOpacity={0.7}
        >
          <Ionicons name="help-circle-outline" size={20} color={Colors.textLight} />
          {!isCollapsed && <Text style={styles.footerBtnText}>Help & Support</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.logoutBtn, isCollapsed && styles.logoutBtnCollapsed]}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          {!isCollapsed && <Text style={styles.logoutText}>Log Out</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );

  // Mobile: overlay with smooth slide-in (CSS on web, instant on native)
  if (!isDesktop) {
    return (
      <Pressable
        style={[
          styles.overlay,
          Platform.OS === 'web' && ({ animation: 'overlayFadeIn 0.25s ease-out' } as any),
        ]}
        onPress={close}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.mobileDrawerWrap,
            Platform.OS === 'web' ? ({ animation: 'drawerSlideIn 0.25s ease-out' } as any) : undefined,
          ]}
        >
          {drawer}
        </Pressable>
      </Pressable>
    );
  }

  return drawer;
}

// ── Styles ──────────────────────────────────────────────
const styles = StyleSheet.create({
  // ── Overlay (mobile) ──────────────────────────────────
  overlay: {
    position: 'absolute' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 1000,
    flexDirection: 'row',
  },
  mobileDrawerWrap: {
    height: '100%',
    width: DRAWER_WIDTH,
    maxWidth: '85%',
  },

  // ── Drawer container ──────────────────────────────────
  drawer: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.borderLight,
    ...(Platform.OS === 'web' ? {
      transition: 'width 0.2s ease',
    } : {}),
  },
  drawerDesktop: {
    position: 'relative' as any,
  },

  // ── Header / Brand ────────────────────────────────────
  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  headerCollapsed: {
    paddingHorizontal: 0,
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  logoWrap: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImg: {
    width: 28,
    height: 28,
  },
  appName: {
    flex: 1,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
  collapseBtn: {
    width: 28,
    height: 28,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryLight,
  },
  closeBtnMobile: {
    width: 28,
    height: 28,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsedLogoBtn: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.highlightSubtle,
    alignSelf: 'center',
  },

  // ── User Card ─────────────────────────────────────────
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    margin: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryLight,
  },
  userCardCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    margin: Spacing.xs,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.highlight,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  userAvatarCollapsed: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  userAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
  },
  userAvatarText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold as any,
    color: Colors.primary,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.success,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  userMeta: {
    flex: 1,
  },
  userName: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textPrimary,
  },
  userRole: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 1,
    textTransform: 'capitalize',
  },

  // ── Navigation ────────────────────────────────────────
  navScroll: {
    flex: 1,
  },
  navScrollContent: {
    paddingBottom: Spacing.md,
  },
  navGroup: {
    paddingTop: Spacing.sm,
  },
  navGroupTitle: {
    fontSize: 10,
    fontWeight: FontWeight.bold as any,
    color: Colors.textLight,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    marginBottom: 2,
  },
  navGroupDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: Spacing.md,
    marginHorizontal: Spacing.xs,
    borderRadius: BorderRadius.sm,
    minHeight: 38,
  },
  navItemCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    marginHorizontal: 0,
  },
  navItemActive: {
    backgroundColor: Colors.highlightSubtle,
  },
  navIconWrap: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconWrapActive: {
    backgroundColor: 'rgba(201, 168, 76, 0.15)',
  },
  navItemText: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium as any,
    color: Colors.textSecondary,
  },
  navItemTextActive: {
    color: Colors.highlight,
    fontWeight: FontWeight.semibold as any,
  },

  // ── Footer ────────────────────────────────────────────
  footer: {
    padding: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    gap: 2,
  },
  footerCollapsed: {
    alignItems: 'center',
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  footerBtnCollapsed: {
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  footerBtnText: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    fontWeight: FontWeight.medium as any,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  logoutBtnCollapsed: {
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  logoutText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium as any,
    color: Colors.error,
  },
});
