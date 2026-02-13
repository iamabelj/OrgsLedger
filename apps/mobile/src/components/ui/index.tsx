// ============================================================
// OrgsLedger Mobile — Shared UI Components
// ============================================================
// A cohesive, royal design component library.
// All components are self-contained with no external dependencies
// beyond React Native and the theme constants.
// ============================================================

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
  Platform,
  TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow, Typography } from '../../theme';

// ────────────────────────────────────────────────────────────
// CARD — Elevated container with optional gold border
// ────────────────────────────────────────────────────────────
interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'default' | 'elevated' | 'gold' | 'flush';
  onPress?: () => void;
}

export function Card({ children, style, variant = 'default', onPress }: CardProps) {
  const cardStyle = [
    styles.card,
    variant === 'elevated' && styles.cardElevated,
    variant === 'gold' && styles.cardGold,
    variant === 'flush' && styles.cardFlush,
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.7}>
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle}>{children}</View>;
}

// ────────────────────────────────────────────────────────────
// BUTTON — Primary, secondary, outline, ghost, danger
// ────────────────────────────────────────────────────────────
interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  iconRight?: React.ComponentProps<typeof Ionicons>['name'];
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading,
  disabled,
  fullWidth,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const sizeStyles = {
    sm: { paddingVertical: Spacing.xs + 2, paddingHorizontal: Spacing.md, fontSize: FontSize.sm },
    md: { paddingVertical: Spacing.sm + 4, paddingHorizontal: Spacing.lg, fontSize: FontSize.md },
    lg: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, fontSize: FontSize.lg },
  };
  const s = sizeStyles[size];
  const iconSize = size === 'sm' ? 14 : size === 'md' ? 18 : 22;

  const buttonBg: Record<string, string> = {
    primary: Colors.highlight,
    secondary: Colors.primaryMid,
    outline: 'transparent',
    ghost: 'transparent',
    danger: Colors.danger,
    success: Colors.success,
  };

  const textColor: Record<string, string> = {
    primary: Colors.textWhite,
    secondary: Colors.textPrimary,
    outline: Colors.highlight,
    ghost: Colors.highlight,
    danger: Colors.textWhite,
    success: Colors.textWhite,
  };

  return (
    <TouchableOpacity
      style={[
        styles.button,
        { backgroundColor: buttonBg[variant], paddingVertical: s.paddingVertical, paddingHorizontal: s.paddingHorizontal },
        variant === 'outline' && { borderWidth: 1.5, borderColor: Colors.highlight },
        variant === 'primary' && Shadow.gold,
        fullWidth && { width: '100%' },
        isDisabled && { opacity: 0.5 },
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor[variant]} />
      ) : (
        <View style={styles.buttonContent}>
          {icon && <Ionicons name={icon} size={iconSize} color={textColor[variant]} style={{ marginRight: Spacing.xs }} />}
          <Text style={[styles.buttonText, { fontSize: s.fontSize, color: textColor[variant] }]}>{title}</Text>
          {iconRight && <Ionicons name={iconRight} size={iconSize} color={textColor[variant]} style={{ marginLeft: Spacing.xs }} />}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ────────────────────────────────────────────────────────────
// BADGE — Status indicators and labels
// ────────────────────────────────────────────────────────────
interface BadgeProps {
  label: string;
  variant?: 'gold' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  size?: 'sm' | 'md';
}

export function Badge({ label, variant = 'neutral', size = 'sm' }: BadgeProps) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    gold: { bg: Colors.highlightSubtle, text: Colors.highlight },
    success: { bg: Colors.successSubtle, text: Colors.success },
    warning: { bg: Colors.warningSubtle, text: Colors.warning },
    danger: { bg: Colors.dangerSubtle, text: Colors.danger },
    info: { bg: Colors.infoSubtle, text: Colors.info },
    neutral: { bg: Colors.accent, text: Colors.textSecondary },
  };
  // Fallback to neutral if variant is not found
  const c = colorMap[variant] || colorMap.neutral;
  const isSmall = size === 'sm';

  return (
    <View style={[styles.badge, { backgroundColor: c.bg }, isSmall ? styles.badgeSm : styles.badgeMd]}>
      <Text style={[styles.badgeText, { color: c.text, fontSize: isSmall ? 9 : 11 }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// AVATAR — User initials / image placeholder
// ────────────────────────────────────────────────────────────
interface AvatarProps {
  name?: string;
  size?: number;
  color?: string;
  style?: ViewStyle;
}

export function Avatar({ name = '?', size = 44, color, style }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const bg = color || Colors.highlight;
  const fontSize = size * 0.38;

  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }, style]}>
      <Text style={[styles.avatarText, { fontSize }]}>{initials}</Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// INPUT — Styled text input with label and error support
// ────────────────────────────────────────────────────────────
interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  containerStyle?: ViewStyle;
}

export function Input({ label, error, icon, containerStyle, style, ...rest }: InputProps) {
  return (
    <View style={[styles.inputContainer, containerStyle]}>
      {label && <Text style={styles.inputLabel}>{label}</Text>}
      <View style={[styles.inputWrapper, error && styles.inputError]}>
        {icon && (
          <Ionicons name={icon} size={18} color={Colors.textLight} style={{ marginRight: Spacing.sm }} />
        )}
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={Colors.textLight}
          selectionColor={Colors.highlight}
          {...rest}
        />
      </View>
      {error && <Text style={styles.inputErrorText}>{error}</Text>}
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// STAT CARD — Financial / metric display card
// ────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  style?: ViewStyle;
}

export function StatCard({ label, value, icon, iconColor = Colors.highlight, trend, trendValue, style }: StatCardProps) {
  const trendColor = trend === 'up' ? Colors.success : trend === 'down' ? Colors.danger : Colors.textSecondary;
  const trendIcon = trend === 'up' ? 'trending-up' : trend === 'down' ? 'trending-down' : 'remove';

  return (
    <View style={[styles.statCard, style]}>
      <View style={styles.statCardHeader}>
        {icon && (
          <View style={[styles.statIconWrap, { backgroundColor: `${iconColor}15` }]}>
            <Ionicons name={icon} size={18} color={iconColor} />
          </View>
        )}
        {trend && trendValue && (
          <View style={styles.statTrend}>
            <Ionicons name={trendIcon} size={12} color={trendColor} />
            <Text style={[styles.statTrendText, { color: trendColor }]}>{trendValue}</Text>
          </View>
        )}
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// SEARCH BAR — Styled search input
// ────────────────────────────────────────────────────────────
interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: ViewStyle;
}

export function SearchBar({ value, onChangeText, placeholder = 'Search...', style }: SearchBarProps) {
  return (
    <View style={[styles.searchBar, style]}>
      <Ionicons name="search" size={18} color={Colors.textLight} />
      <TextInput
        style={styles.searchInput}
        placeholder={placeholder}
        placeholderTextColor={Colors.textLight}
        value={value}
        onChangeText={onChangeText}
        selectionColor={Colors.highlight}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChangeText('')}>
          <Ionicons name="close-circle" size={18} color={Colors.textLight} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// DIVIDER — Horizontal line with optional label
// ────────────────────────────────────────────────────────────
interface DividerProps {
  label?: string;
  style?: ViewStyle;
}

export function Divider({ label, style }: DividerProps) {
  if (label) {
    return (
      <View style={[styles.dividerRow, style]}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerLabel}>{label}</Text>
        <View style={styles.dividerLine} />
      </View>
    );
  }
  return <View style={[styles.dividerSingle, style]} />;
}

// ────────────────────────────────────────────────────────────
// LIST ITEM — Pressable row with icon, title, subtitle
// ────────────────────────────────────────────────────────────
interface ListItemProps {
  title: string;
  subtitle?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
  rightText?: string;
  rightElement?: React.ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  style?: ViewStyle;
}

export function ListItem({ title, subtitle, icon, iconColor = Colors.textSecondary, rightText, rightElement, onPress, showChevron = true, style }: ListItemProps) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={[styles.listItem, style]} onPress={onPress} activeOpacity={0.6}>
      {icon && (
        <View style={[styles.listItemIcon, { backgroundColor: `${iconColor}15` }]}>
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>
      )}
      <View style={styles.listItemContent}>
        <Text style={styles.listItemTitle}>{title}</Text>
        {subtitle && <Text style={styles.listItemSubtitle}>{subtitle}</Text>}
      </View>
      {rightText && <Text style={styles.listItemRight}>{rightText}</Text>}
      {rightElement}
      {onPress && showChevron && (
        <Ionicons name="chevron-forward" size={18} color={Colors.textLight} style={{ marginLeft: Spacing.xs }} />
      )}
    </Wrapper>
  );
}

// ────────────────────────────────────────────────────────────
// EMPTY STATE — Centered illustration with text
// ────────────────────────────────────────────────────────────
interface EmptyStateProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function EmptyState({ icon, title, subtitle, actionLabel, onAction, style }: EmptyStateProps) {
  return (
    <View style={[styles.emptyState, style]}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name={icon} size={48} color={Colors.textLight} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle && <Text style={styles.emptySubtitle}>{subtitle}</Text>}
      {actionLabel && onAction && (
        <Button title={actionLabel} onPress={onAction} variant="outline" size="sm" style={{ marginTop: Spacing.md }} />
      )}
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// SECTION HEADER — Title with optional action
// ────────────────────────────────────────────────────────────
interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function SectionHeader({ title, actionLabel, onAction, style }: SectionHeaderProps) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity onPress={onAction}>
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// SCREEN WRAPPER — Consistent screen container
// ────────────────────────────────────────────────────────────
interface ScreenWrapperProps {
  children: React.ReactNode;
  style?: ViewStyle;
  centered?: boolean;
}

export function ScreenWrapper({ children, style, centered }: ScreenWrapperProps) {
  return (
    <View style={[styles.screenWrapper, centered && styles.screenCentered, style]}>
      {children}
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// LOADING SCREEN — Full screen loading indicator
// ────────────────────────────────────────────────────────────
export function LoadingScreen() {
  return (
    <View style={styles.loadingScreen}>
      <ActivityIndicator size="large" color={Colors.highlight} />
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// STYLES
// ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Card
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadow.sm,
  },
  cardElevated: {
    backgroundColor: Colors.surfaceElevated,
    ...Shadow.md,
  },
  cardGold: {
    borderColor: Colors.borderGold,
    ...Shadow.gold,
  },
  cardFlush: {
    padding: 0,
    borderWidth: 0,
    ...Shadow.sm,
  },

  // Button
  button: {
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontWeight: FontWeight.semibold,
  },

  // Badge
  badge: {
    borderRadius: BorderRadius.full,
    alignSelf: 'flex-start',
  },
  badgeSm: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  badgeMd: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  badgeText: {
    fontWeight: FontWeight.bold,
    letterSpacing: 0.5,
  },

  // Avatar
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: Colors.textWhite,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.5,
  },

  // Input
  inputContainer: {
    marginBottom: Spacing.md,
  },
  inputLabel: {
    ...Typography.label,
    marginBottom: Spacing.xs,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.accent,
    paddingHorizontal: Spacing.md,
  },
  input: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    paddingVertical: Platform.OS === 'ios' ? Spacing.sm + 4 : Spacing.sm,
  },
  inputError: {
    borderColor: Colors.danger,
  },
  inputErrorText: {
    color: Colors.danger,
    fontSize: FontSize.xs,
    marginTop: Spacing.xxs,
    marginLeft: Spacing.xs,
  },

  // Stat Card
  statCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    flex: 1,
    minWidth: 140,
    ...Shadow.sm,
  },
  statCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  statIconWrap: {
    width: 34,
    height: 34,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  statTrendText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  statValue: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: FontWeight.medium,
  },

  // Search Bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    paddingVertical: Spacing.sm + 2,
    fontSize: FontSize.md,
  },

  // Divider
  dividerSingle: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: Spacing.md,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.md,
    gap: Spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.borderLight,
  },
  dividerLabel: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // List Item
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 4,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  listItemIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  listItemContent: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  listItemSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  listItemRight: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginRight: Spacing.xs,
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxxl,
    paddingHorizontal: Spacing.xl,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  emptyTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xs,
    lineHeight: 22,
    maxWidth: 300,
  },

  // Section Header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  sectionAction: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.highlight,
  },

  // Screen Wrapper
  screenWrapper: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  screenCentered: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Loading
  loadingScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});

// Re-export PoweredByFooter
export { PoweredByFooter } from './PoweredByFooter';
export { CrossPlatformDateTimePicker } from './CrossPlatformDateTimePicker';
export { default as LiveTranslation } from './LiveTranslation';
