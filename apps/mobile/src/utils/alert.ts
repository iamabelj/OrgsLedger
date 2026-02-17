// ============================================================
// OrgsLedger Mobile — Cross-Platform Alert Utility
// ============================================================
// Now routes simple messages through the Toast system for
// professional inline notifications, while keeping native
// confirm dialogs for multi-button flows.
// ============================================================

import { Alert, Platform } from 'react-native';
import { showToast, type ToastVariant } from '../components/ui/Toast';

/** Map common alert titles to toast variants */
function inferVariant(title: string): ToastVariant {
  const t = title.toLowerCase();
  if (t.includes('success') || t.includes('saved') || t.includes('done') || t.includes('verified') ||
      t.includes('created') || t.includes('deleted') || t.includes('removed') || t.includes('updated') ||
      t.includes('copied') || t.includes('exported') || t.includes('joined') || t.includes('voted') ||
      t.includes('thank') || t.includes('sent') || t.includes('invite'))
    return 'success';
  if (t.includes('error') || t.includes('fail') || t.includes('invalid') || t.includes('denied') ||
      t.includes('not found') || t.includes('missing') || t.includes('not supported'))
    return 'error';
  if (t.includes('warning') || t.includes('validation') || t.includes('permission'))
    return 'warning';
  return 'info';
}

/**
 * Cross-platform alert that works on iOS, Android, and Web.
 *
 * - Simple notifications (0-1 buttons, no destructive flow) → inline Toast
 * - Confirmation dialogs (2+ buttons) → native Alert/confirm
 */
export function showAlert(
  title: string,
  message?: string,
  buttons?: Array<{ text: string; onPress?: () => void; style?: string }>
): void {
  // ── Confirmation dialogs: keep native behavior ──
  if (buttons && buttons.length > 1) {
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(message ? `${title}\n\n${message}` : title);
      if (confirmed) {
        const actionBtn = buttons.find((b) => b.style !== 'cancel') || buttons[buttons.length - 1];
        actionBtn?.onPress?.();
      } else {
        const cancelBtn = buttons.find((b) => b.style === 'cancel');
        cancelBtn?.onPress?.();
      }
    } else {
      Alert.alert(title, message, buttons as any);
    }
    return;
  }

  // ── Simple notifications → Toast ──
  const variant = inferVariant(title);
  const displayMsg = message || title;
  const toastTitle = message ? title : undefined; // only show title if there's a separate message

  const callback = buttons?.[0]?.onPress;

  showToast(displayMsg, variant, {
    title: toastTitle,
    duration: variant === 'error' ? 5000 : 3000,
    action: callback ? { label: buttons![0].text || 'OK', onPress: callback } : undefined,
  });
}

/**
 * Cross-platform confirm dialog
 * Returns a promise that resolves to true if confirmed, false otherwise
 */
export function showConfirm(title: string, message?: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
      const result = window.confirm(message ? `${title}\n\n${message}` : title);
      resolve(result);
    } else {
      Alert.alert(
        title,
        message,
        [
          { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
          { text: 'OK', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      );
    }
  });
}
