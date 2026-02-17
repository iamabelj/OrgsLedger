// ============================================================
// OrgsLedger — Toast Notification System
// ============================================================
// Professional inline toast notifications that replace pop-up alerts.
// Supports success, error, warning, and info variants.
// Auto-dismisses after a configurable duration.
// ============================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../theme';

// ── Types ───────────────────────────────────────────────────

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  title?: string;
  message: string;
  variant: ToastVariant;
  duration?: number; // ms, 0 = persistent
  action?: { label: string; onPress: () => void };
}

// ── Global Toast State ──────────────────────────────────────

type ToastListener = (toasts: ToastMessage[]) => void;

let _toasts: ToastMessage[] = [];
let _listeners: ToastListener[] = [];
let _idCounter = 0;

function notifyListeners() {
  _listeners.forEach((fn) => fn([..._toasts]));
}

/**
 * Show a toast notification from anywhere in the app.
 * Returns the toast ID for manual dismissal.
 */
export function showToast(
  message: string,
  variant: ToastVariant = 'info',
  options?: { title?: string; duration?: number; action?: { label: string; onPress: () => void } }
): string {
  const id = `toast_${++_idCounter}_${Date.now()}`;
  const toast: ToastMessage = {
    id,
    message,
    variant,
    title: options?.title,
    duration: options?.duration ?? (variant === 'error' ? 5000 : 3000),
    action: options?.action,
  };
  _toasts = [..._toasts, toast];
  notifyListeners();
  return id;
}

/** Convenience wrappers */
export const toast = {
  success: (msg: string, options?: { title?: string; duration?: number; action?: { label: string; onPress: () => void } }) =>
    showToast(msg, 'success', options),
  error: (msg: string, options?: { title?: string; duration?: number; action?: { label: string; onPress: () => void } }) =>
    showToast(msg, 'error', { duration: 5000, ...options }),
  warning: (msg: string, options?: { title?: string; duration?: number; action?: { label: string; onPress: () => void } }) =>
    showToast(msg, 'warning', options),
  info: (msg: string, options?: { title?: string; duration?: number; action?: { label: string; onPress: () => void } }) =>
    showToast(msg, 'info', options),
};

export function dismissToast(id: string) {
  _toasts = _toasts.filter((t) => t.id !== id);
  notifyListeners();
}

export function clearAllToasts() {
  _toasts = [];
  notifyListeners();
}

// ── Variant Styles ──────────────────────────────────────────

const VARIANT_CONFIG: Record<ToastVariant, { bg: string; border: string; icon: string; iconColor: string }> = {
  success: { bg: '#F0FFF4', border: '#38A169', icon: 'checkmark-circle', iconColor: '#38A169' },
  error:   { bg: '#FFF5F5', border: '#E53E3E', icon: 'alert-circle', iconColor: '#E53E3E' },
  warning: { bg: '#FFFBEB', border: '#D69E2E', icon: 'warning', iconColor: '#D69E2E' },
  info:    { bg: '#EBF8FF', border: '#3182CE', icon: 'information-circle', iconColor: '#3182CE' },
};

// ── Single Toast Item ───────────────────────────────────────

function ToastItem({ item, onDismiss }: { item: ToastMessage; onDismiss: (id: string) => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;
  const cfg = VARIANT_CONFIG[item.variant];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();

    if (item.duration && item.duration > 0) {
      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: -20, duration: 200, useNativeDriver: true }),
        ]).start(() => onDismiss(item.id));
      }, item.duration);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <Animated.View style={[styles.toastItem, { backgroundColor: cfg.bg, borderLeftColor: cfg.border, opacity, transform: [{ translateY }] }]}>
      <Ionicons name={cfg.icon as any} size={20} color={cfg.iconColor} style={styles.toastIcon} />
      <View style={styles.toastContent}>
        {item.title && <Text style={[styles.toastTitle, { color: cfg.border }]}>{item.title}</Text>}
        <Text style={styles.toastMessage} numberOfLines={3}>{item.message}</Text>
        {item.action && (
          <TouchableOpacity onPress={() => { item.action!.onPress(); onDismiss(item.id); }} style={styles.actionBtn}>
            <Text style={[styles.actionText, { color: cfg.border }]}>{item.action.label}</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity onPress={() => onDismiss(item.id)} style={styles.dismissBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={16} color="#999" />
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Toast Container (mount once in root layout) ─────────────

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const listener = (t: ToastMessage[]) => setToasts(t);
    _listeners.push(listener);
    return () => {
      _listeners = _listeners.filter((l) => l !== listener);
    };
  }, []);

  const handleDismiss = useCallback((id: string) => {
    dismissToast(id);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {toasts.slice(-5).map((t) => (
        <ToastItem key={t.id} item={t} onDismiss={handleDismiss} />
      ))}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 16 : 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 99999,
    pointerEvents: 'box-none',
  },
  toastItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: Platform.OS === 'web' ? '90%' : '92%',
    maxWidth: 500,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 4,
    // Shadow
    ...Platform.select({
      web: { boxShadow: '0 4px 12px rgba(0,0,0,0.12)' } as any,
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 6,
        elevation: 6,
      },
    }),
  },
  toastIcon: {
    marginRight: 10,
    marginTop: 1,
  },
  toastContent: {
    flex: 1,
  },
  toastTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold as any,
    marginBottom: 2,
  },
  toastMessage: {
    fontSize: FontSize.sm,
    color: '#333',
    lineHeight: 18,
  },
  actionBtn: {
    marginTop: 6,
  },
  actionText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold as any,
  },
  dismissBtn: {
    marginLeft: 8,
    padding: 2,
  },
});
