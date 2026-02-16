// ============================================================
// OrgsLedger — Navigation Drawer Context
// ============================================================
// Supports: open (full), collapsed (icons-only on desktop), closed (mobile)

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Platform, Dimensions } from 'react-native';

export const DRAWER_WIDTH = 260;
export const DRAWER_COLLAPSED_WIDTH = 72;

interface DrawerContextValue {
  isOpen: boolean;
  isCollapsed: boolean;
  /** Effective drawer width (0 if closed, 72 if collapsed, 260 if open) */
  drawerWidth: number;
  toggle: () => void;
  open: () => void;
  close: () => void;
  collapse: () => void;
  expand: () => void;
  toggleCollapse: () => void;
  /** True when desktop (>= 1024) */
  isDesktop: boolean;
}

const DrawerContext = createContext<DrawerContextValue | undefined>(undefined);

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const getWidth = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') return window.innerWidth;
    return Dimensions.get('window').width;
  };

  const [windowWidth, setWindowWidth] = useState(getWidth);
  const isDesktop = windowWidth >= 1024;
  const isTablet = windowWidth >= 768 && windowWidth < 1024;

  // Desktop starts open, mobile/tablet starts closed
  const [isOpen, setIsOpen] = useState(() => isDesktop);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Listen to window resize on web
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-adjust on breakpoint change
  useEffect(() => {
    if (isDesktop) {
      setIsOpen(true);
      setIsCollapsed(false);
    } else {
      setIsOpen(false);
      setIsCollapsed(false);
    }
  }, [isDesktop]);

  const drawerWidth = !isOpen ? 0 : isCollapsed ? DRAWER_COLLAPSED_WIDTH : DRAWER_WIDTH;

  const toggle = useCallback(() => {
    if (isDesktop) {
      // Desktop: toggle between full and collapsed
      if (isOpen && !isCollapsed) {
        setIsCollapsed(true);
      } else if (isOpen && isCollapsed) {
        setIsCollapsed(false);
      } else {
        setIsOpen(true);
        setIsCollapsed(false);
      }
    } else {
      // Mobile: toggle open/close
      setIsOpen(prev => !prev);
    }
  }, [isDesktop, isOpen, isCollapsed]);

  const value: DrawerContextValue = {
    isOpen,
    isCollapsed,
    drawerWidth,
    toggle,
    open: useCallback(() => { setIsOpen(true); setIsCollapsed(false); }, []),
    close: useCallback(() => setIsOpen(false), []),
    collapse: useCallback(() => { setIsOpen(true); setIsCollapsed(true); }, []),
    expand: useCallback(() => { setIsOpen(true); setIsCollapsed(false); }, []),
    toggleCollapse: useCallback(() => setIsCollapsed(prev => !prev), []),
    isDesktop,
  };

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

export function useDrawer() {
  const context = useContext(DrawerContext);
  if (!context) {
    throw new Error('useDrawer must be used within DrawerProvider');
  }
  return context;
}
