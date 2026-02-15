// ============================================================
// OrgsLedger — Responsive Navigation Drawer/Sidebar
// ============================================================

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Dimensions,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useAuthStore } from '../stores/auth.store';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../theme';
import { useDrawer } from '../contexts/DrawerContext';

const DRAWER_WIDTH = 280;
const MOBILE_BREAKPOINT = 768;

interface NavItem {
  label: string;
  icon: string;
  path: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Home', icon: 'home-outline', path: '/(tabs)/home' },
  { label: 'Chat', icon: 'chatbubbles-outline', path: '/(tabs)/chat' },
  { label: 'Meetings', icon: 'people-outline', path: '/(tabs)/meetings' },
  { label: 'Financials', icon: 'wallet-outline', path: '/(tabs)/financials' },
  { label: 'Announcements', icon: 'megaphone-outline', path: '/announcements' },
  { label: 'Events', icon: 'calendar-outline', path: '/events' },
  { label: 'Polls', icon: 'bar-chart-outline', path: '/polls' },
  { label: 'Documents', icon: 'document-text-outline', path: '/documents' },
  { label: 'Profile', icon: 'person-outline', path: '/(tabs)/profile' },
  { label: 'Help & Support', icon: 'help-circle-outline', path: '/help' },
];

const adminItems: NavItem[] = [
  { label: 'Members', icon: 'people-circle-outline', path: '/admin/members', adminOnly: true },
  { label: 'Create Due', icon: 'card-outline', path: '/admin/create-due', adminOnly: true },
  { label: 'Create Fine', icon: 'alert-circle-outline', path: '/admin/create-fine', adminOnly: true },
  { label: 'Donation Campaign', icon: 'heart-outline', path: '/admin/create-campaign', adminOnly: true },
  { label: 'Expenses', icon: 'receipt-outline', path: '/admin/expenses', adminOnly: true },
  { label: 'Committees', icon: 'git-branch-outline', path: '/admin/committees', adminOnly: true },
  { label: 'Reports', icon: 'stats-chart-outline', path: '/admin/reports', adminOnly: true },
  { label: 'Settings', icon: 'settings-outline', path: '/admin/settings', adminOnly: true },
  { label: 'AI Plans', icon: 'sparkles-outline', path: '/admin/plans', adminOnly: true },
  { label: 'Analytics', icon: 'analytics-outline', path: '/admin/analytics', adminOnly: true },
  { label: 'Bank Transfers', icon: 'swap-horizontal-outline', path: '/admin/bank-transfers', adminOnly: true },
  { label: 'Pay Config', icon: 'card-outline', path: '/admin/payment-methods', adminOnly: true },
  { label: 'Subscription', icon: 'ribbon-outline', path: '/admin/subscription', adminOnly: true },
  { label: 'Compliance', icon: 'shield-checkmark-outline', path: '/admin/compliance', adminOnly: true },
];

// Developer-only items
const developerItems: NavItem[] = [
  { label: 'Developer Console', icon: 'code-slash-outline', path: '/admin/developer-console' },
  { label: 'SaaS Dashboard', icon: 'stats-chart-outline', path: '/admin/saas-dashboard' },
];

// Executive gets a subset — no Settings, AI Plans, Pay Config, Bank Transfers, Analytics
const executiveItems: NavItem[] = [
  { label: 'Members', icon: 'people-circle-outline', path: '/admin/members', adminOnly: true },
  { label: 'Create Due', icon: 'card-outline', path: '/admin/create-due', adminOnly: true },
  { label: 'Donation Campaign', icon: 'heart-outline', path: '/admin/create-campaign', adminOnly: true },
  { label: 'Expenses', icon: 'receipt-outline', path: '/admin/expenses', adminOnly: true },
  { label: 'Committees', icon: 'git-branch-outline', path: '/admin/committees', adminOnly: true },
  { label: 'Reports', icon: 'stats-chart-outline', path: '/admin/reports', adminOnly: true },
];

export function NavigationDrawer() {
  const pathname = usePathname();
  const { isOpen, close } = useDrawer();
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
  const isMobile = Dimensions.get('window').width < MOBILE_BREAKPOINT;
  const isWeb = Platform.OS === 'web';

  // Never show drawer when not authenticated (login/register screens)
  const shouldShow = isOpen && isAuthenticated;

  const handleNavigation = (path: string) => {
    router.push(path as any);
    if (isMobile) {
      close();
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  if (!shouldShow) {
    return null;
  }

  const drawer = (
    <View style={[styles.drawer, isWeb && !isMobile && styles.drawerDesktop]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Ionicons name="business" size={32} color={Colors.highlight} />
          <Text style={styles.appName}>OrgsLedger</Text>
        </View>
        <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={28} color={Colors.textLight} />
        </TouchableOpacity>
      </View>

      {/* User Info */}
      {user && (
        <View style={styles.userInfo}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user.firstName?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>
              {user.firstName} {user.lastName}
            </Text>
            <Text style={styles.userEmail} numberOfLines={1}>
              {user.email}
            </Text>
          </View>
        </View>
      )}

      <ScrollView style={styles.navSection} showsVerticalScrollIndicator={false}>
        {/* Main Navigation */}
        <View style={styles.navGroup}>
          <Text style={styles.navGroupTitle}>MAIN</Text>
          {navItems.map((item) => {
            const isActive = pathname === item.path || pathname?.startsWith(item.path);
            return (
              <TouchableOpacity
                key={item.path}
                style={[styles.navItem, isActive && styles.navItemActive]}
                onPress={() => handleNavigation(item.path)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={item.icon as any}
                  size={22}
                  color={isActive ? Colors.highlight : Colors.textLight}
                />
                <Text style={[styles.navItemText, isActive && styles.navItemTextActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Admin Section */}
        {isAdmin && (
          <View style={styles.navGroup}>
            <Text style={styles.navGroupTitle}>{isOrgAdmin ? 'SUPER ADMIN' : 'EXECUTIVE'}</Text>
            {drawerAdminItems.map((item) => {
              const isActive = pathname === item.path || pathname?.startsWith(item.path);
              return (
                <TouchableOpacity
                  key={item.path}
                  style={[styles.navItem, isActive && styles.navItemActive]}
                  onPress={() => handleNavigation(item.path)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={22}
                    color={isActive ? Colors.highlight : Colors.textLight}
                  />
                  <Text style={[styles.navItemText, isActive && styles.navItemTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Developer Section */}
        {isSuperAdmin && (
          <View style={styles.navGroup}>
            <Text style={styles.navGroupTitle}>DEVELOPER</Text>
            {developerItems.map((item) => {
              const isActive = pathname === item.path || pathname?.startsWith(item.path);
              return (
                <TouchableOpacity
                  key={item.path}
                  style={[styles.navItem, isActive && styles.navItemActive]}
                  onPress={() => handleNavigation(item.path)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={22}
                    color={isActive ? Colors.highlight : Colors.textLight}
                  />
                  <Text style={[styles.navItemText, isActive && styles.navItemTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Legal & Compliance */}
        <View style={styles.navGroup}>
          <Text style={styles.navGroupTitle}>LEGAL</Text>
          {[
            { label: 'Terms of Service', icon: 'document-text-outline', path: '/legal/terms' },
            { label: 'Privacy Policy', icon: 'shield-checkmark-outline', path: '/legal/privacy' },
            { label: 'Data Processing', icon: 'server-outline', path: '/legal/dpa' },
            { label: 'Acceptable Use', icon: 'hand-left-outline', path: '/legal/acceptable-use' },
          ].map((item) => {
            const isActive = pathname === item.path;
            return (
              <TouchableOpacity
                key={item.path}
                style={[styles.navItem, isActive && styles.navItemActive]}
                onPress={() => handleNavigation(item.path)}
                activeOpacity={0.7}
              >
                <Ionicons name={item.icon as any} size={22} color={isActive ? Colors.highlight : Colors.textLight} />
                <Text style={[styles.navItemText, isActive && styles.navItemTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // On mobile, wrap in overlay
  if (isMobile) {
    return (
      <Pressable style={styles.overlay} onPress={close}>
        <Pressable style={{ flex: 1 }} onPress={(e) => e.stopPropagation()}>
          {drawer}
        </Pressable>
      </Pressable>
    );
  }

  // On desktop web, show directly
  return drawer;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
  },
  drawer: {
    width: DRAWER_WIDTH,
    height: '100%',
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.accent,
    ...(Platform.OS === 'web' && {
      position: 'absolute' as any,
      left: 0,
      top: 0,
      bottom: 0,
    }),
  },
  drawerDesktop: {
    position: 'relative' as any,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  appName: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    backgroundColor: Colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold as any,
    color: Colors.primary,
  },
  userName: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textWhite,
  },
  userEmail: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
  },
  navSection: {
    flex: 1,
  },
  navGroup: {
    paddingVertical: Spacing.md,
  },
  navGroupTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold as any,
    color: Colors.textLight,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    letterSpacing: 1,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  navItemActive: {
    backgroundColor: Colors.highlightSubtle,
  },
  navItemText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium as any,
    color: Colors.textLight,
  },
  navItemTextActive: {
    color: Colors.highlight,
    fontWeight: FontWeight.semibold as any,
  },
  footer: {
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.accent,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.errorSubtle,
  },
  logoutText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium as any,
    color: Colors.error,
  },
});
