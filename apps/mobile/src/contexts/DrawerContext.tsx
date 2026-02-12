// ============================================================
// OrgsLedger — Navigation Drawer Context
// ============================================================

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform, Dimensions } from 'react-native';

interface DrawerContextValue {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

const DrawerContext = createContext<DrawerContextValue | undefined>(undefined);

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  // Start open on desktop web, closed on mobile
  const [isOpen, setIsOpen] = useState(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return window.innerWidth >= 768;
    }
    return false;
  });

  const value: DrawerContextValue = {
    isOpen,
    toggle: () => setIsOpen((prev) => !prev),
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
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
