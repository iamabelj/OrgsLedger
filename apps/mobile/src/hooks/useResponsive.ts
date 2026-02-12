// ============================================================
// OrgsLedger Mobile — Responsive Layout Hook
// ============================================================
// Adapts layouts for phone, tablet, and web viewports.
// ============================================================

import { useWindowDimensions, Platform } from 'react-native';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

interface ResponsiveValues {
  width: number;
  height: number;
  breakpoint: Breakpoint;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isWeb: boolean;
  /** Number of grid columns for list layouts */
  columns: number;
  /** Content max width for centered layouts */
  contentMaxWidth: number;
  /** Horizontal padding for the content area */
  contentPadding: number;
  /** Scale factor for font sizes on larger screens */
  fontScale: number;
  /** Card width for grid layout */
  cardWidth: (gap?: number) => number;
}

const BREAKPOINTS = {
  tablet: 768,
  desktop: 1024,
};

export function useResponsive(): ResponsiveValues {
  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';

  let breakpoint: Breakpoint = 'phone';
  let columns = 1;
  let contentMaxWidth = width;
  let contentPadding = 16;
  let fontScale = 1;

  if (width >= BREAKPOINTS.desktop) {
    breakpoint = 'desktop';
    columns = 3;
    contentMaxWidth = 1200;
    contentPadding = 32;
    fontScale = 1.05;
  } else if (width >= BREAKPOINTS.tablet) {
    breakpoint = 'tablet';
    columns = 2;
    contentMaxWidth = 900;
    contentPadding = 24;
    fontScale = 1.02;
  }

  const cardWidth = (gap: number = 16) => {
    const usableWidth = Math.min(width, contentMaxWidth) - contentPadding * 2;
    return (usableWidth - gap * (columns - 1)) / columns;
  };

  return {
    width,
    height,
    breakpoint,
    isPhone: breakpoint === 'phone',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop',
    isWeb,
    columns,
    contentMaxWidth,
    contentPadding,
    fontScale,
    cardWidth,
  };
}
