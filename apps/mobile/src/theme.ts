// ============================================================
// OrgsLedger Mobile — Royal Design System
// ============================================================
// A premium, elegant design inspired by royal aesthetics:
// Deep navy foundations, gold accents, refined typography.

import { Platform } from 'react-native';
// ============================================================

export const Colors = {
  // ── Core Palette ──────────────────────────────────────
  primary: '#0B1426',        // Deep navy — app chrome, headers
  primaryLight: '#132039',   // Slightly lighter navy — inputs, wells
  primaryMid: '#1A2744',     // Mid navy — elevated surfaces
  accent: '#1E3054',         // Navy accent — borders, dividers

  // ── Gold / Highlight ──────────────────────────────────
  highlight: '#C9A84C',      // Rich gold — primary CTAs, active states
  highlightLight: '#D4BF7A', // Softer gold — hover, secondary emphasis
  highlightDark: '#A68B3C',  // Darker gold — pressed states
  highlightSubtle: 'rgba(201, 168, 76, 0.12)', // Gold wash — cards

  // ── Status Colors ─────────────────────────────────────
  success: '#2ECC71',        // Emerald green
  successDark: '#1B7A4E',    // Deep emerald
  successSubtle: 'rgba(46, 204, 113, 0.12)',
  warning: '#E67E22',        // Amber
  warningSubtle: 'rgba(230, 126, 34, 0.12)',
  error: '#C0392B',          // Crimson
  danger: '#C0392B',         // Alias for error
  dangerSubtle: 'rgba(192, 57, 43, 0.12)',
  info: '#2980B9',           // Sapphire
  infoSubtle: 'rgba(41, 128, 185, 0.12)',

  // ── Surfaces ──────────────────────────────────────────
  background: '#060D18',     // Deepest navy — screen background
  surface: '#0F1A2E',        // Card surface
  surfaceElevated: '#162040', // Elevated card (modal, dropdown)
  surfaceAlt: '#1A2744',     // Alternative surface
  surfaceHover: '#1E2D4A',   // Hover state for interactive surfaces

  // ── Borders ───────────────────────────────────────────
  border: '#1E3054',         // Standard border
  borderLight: '#162040',    // Subtle border
  borderGold: 'rgba(201, 168, 76, 0.3)', // Gold-tinted border

  // ── Text ──────────────────────────────────────────────
  textPrimary: '#F0EDE5',    // Ivory — primary text on dark
  textSecondary: '#8E99A9',  // Silver — secondary text
  textLight: '#5A6A7E',      // Muted — tertiary text, labels
  textWhite: '#FFFFFF',      // Pure white — high emphasis
  textGold: '#C9A84C',       // Gold text — accents, links

  // ── Status Colors (aliases) ───────────────────────────
  pending: '#E67E22',
  completed: '#2ECC71',
  failed: '#C0392B',
  refunded: '#8E44AD',

  // ── Gradients (as array pairs for LinearGradient) ─────
  gradientPrimary: ['#0B1426', '#162040'] as [string, string],
  gradientGold: ['#C9A84C', '#D4BF7A'] as [string, string],
  gradientSuccess: ['#1B7A4E', '#2ECC71'] as [string, string],

  // ── Shadows ───────────────────────────────────────────
  shadowColor: '#000000',
  shadowGold: 'rgba(201, 168, 76, 0.15)',

  // ── Status Subtle ─────────────────────────────────────
  errorSubtle: 'rgba(192, 57, 43, 0.12)',

  // ── Overlay ───────────────────────────────────────────
  overlay: 'rgba(6, 13, 24, 0.7)',
  overlayLight: 'rgba(6, 13, 24, 0.4)',
};

export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
};

export const FontSize = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 22,
  title: 26,
  header: 32,
  display: 40,
};

export const FontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
};

export const BorderRadius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  xxl: 24,
  full: 999,
};

const makeShadow = (color: string, offsetY: number, opacity: number, radius: number, elevation: number) => {
  if (Platform.OS === 'web') {
    // Build a proper rgba color string for web boxShadow
    let rgbaColor: string;
    if (color.startsWith('rgba(')) {
      // Already rgba — extract r,g,b and replace the alpha with our opacity
      const match = color.match(/rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[\d.]+\s*\)/);
      if (match) {
        rgbaColor = `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${opacity})`;
      } else {
        rgbaColor = `rgba(0, 0, 0, ${opacity})`;
      }
    } else if (color.startsWith('rgb(')) {
      // rgb → rgba with our opacity
      rgbaColor = color.replace('rgb(', 'rgba(').replace(')', `, ${opacity})`);
    } else {
      // Hex or named color — default to black rgba
      rgbaColor = `rgba(0, 0, 0, ${opacity})`;
    }
    return { boxShadow: `0px ${offsetY}px ${radius}px ${rgbaColor}` } as any;
  }
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation,
  };
};

export const Shadow = {
  sm: makeShadow(Colors.shadowColor, 1, 0.15, 3, 2),
  md: makeShadow(Colors.shadowColor, 3, 0.2, 6, 4),
  lg: makeShadow(Colors.shadowColor, 6, 0.25, 12, 8),
  gold: makeShadow(Colors.shadowGold, 2, 0.4, 8, 4),
};

// ── Typography Presets ──────────────────────────────────
export const Typography = {
  display: { fontSize: FontSize.display, fontWeight: FontWeight.extrabold, color: Colors.textPrimary, letterSpacing: -0.5 },
  h1: { fontSize: FontSize.header, fontWeight: FontWeight.bold, color: Colors.textPrimary, letterSpacing: -0.3 },
  h2: { fontSize: FontSize.title, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  h3: { fontSize: FontSize.xxl, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  h4: { fontSize: FontSize.xl, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  body: { fontSize: FontSize.md, fontWeight: FontWeight.regular, color: Colors.textPrimary, lineHeight: 22 },
  bodySmall: { fontSize: FontSize.sm, fontWeight: FontWeight.regular, color: Colors.textSecondary },
  caption: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.textLight, letterSpacing: 0.5 },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textSecondary, letterSpacing: 0.3, textTransform: 'uppercase' as const },
  button: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.textWhite },
  link: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.highlight },
};
