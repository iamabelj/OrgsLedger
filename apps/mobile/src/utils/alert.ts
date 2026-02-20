// ============================================================
// OrgsLedger Mobile — Cross-Platform Alert Utility
// ============================================================
// Routes simple messages through the Toast system for
// professional inline notifications, while keeping native
// confirm dialogs for multi-button flows. On web, uses a
// custom themed modal instead of window.confirm().
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

// ── Web Custom Dialog ───────────────────────────────────────

/**
 * Show a themed confirmation dialog on web using DOM elements.
 * Immediately visible, single click to confirm/cancel.
 */
function showWebDialog(
  title: string,
  message: string | undefined,
  buttons: Array<{ text: string; onPress?: () => void; style?: string }>
): void {
  // Backdrop
  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '99999',
    animation: 'orgsledger-fade-in 150ms ease-out',
  });

  // Dialog card
  const dialog = document.createElement('div');
  Object.assign(dialog.style, {
    backgroundColor: '#0F1A2E',
    border: '1px solid #1E3054',
    borderRadius: '12px',
    padding: '24px',
    minWidth: '320px',
    maxWidth: '420px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
    animation: 'orgsledger-scale-in 150ms ease-out',
  });

  // Title
  const titleEl = document.createElement('div');
  titleEl.textContent = title;
  Object.assign(titleEl.style, {
    color: '#F0EDE5',
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: message ? '8px' : '20px',
  });
  dialog.appendChild(titleEl);

  // Message
  if (message) {
    const msgEl = document.createElement('div');
    msgEl.textContent = message;
    Object.assign(msgEl.style, {
      color: '#8E99A9',
      fontSize: '14px',
      lineHeight: '1.5',
      marginBottom: '20px',
    });
    dialog.appendChild(msgEl);
  }

  // Buttons row
  const btnRow = document.createElement('div');
  Object.assign(btnRow.style, {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
  });

  const cleanup = () => {
    backdrop.remove();
  };

  // Close on backdrop click
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      const cancelBtn = buttons.find((b) => b.style === 'cancel');
      cancelBtn?.onPress?.();
      cleanup();
    }
  });

  // Render each button
  buttons.forEach((btn) => {
    const el = document.createElement('button');
    el.textContent = btn.text;
    const isCancel = btn.style === 'cancel';
    const isDestructive = btn.style === 'destructive';
    Object.assign(el.style, {
      padding: '10px 20px',
      borderRadius: '8px',
      border: isCancel ? '1px solid #1E3054' : 'none',
      backgroundColor: isDestructive ? '#C0392B' : isCancel ? 'transparent' : '#C9A84C',
      color: isCancel ? '#8E99A9' : '#FFFFFF',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      outline: 'none',
      transition: 'opacity 150ms',
    });
    el.addEventListener('mouseenter', () => { el.style.opacity = '0.85'; });
    el.addEventListener('mouseleave', () => { el.style.opacity = '1'; });
    el.addEventListener('click', () => {
      btn.onPress?.();
      cleanup();
    });
    btnRow.appendChild(el);
  });

  dialog.appendChild(btnRow);
  backdrop.appendChild(dialog);

  // Inject keyframe animations (once)
  if (!document.getElementById('orgsledger-dialog-styles')) {
    const style = document.createElement('style');
    style.id = 'orgsledger-dialog-styles';
    style.textContent = `
      @keyframes orgsledger-fade-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes orgsledger-scale-in { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(backdrop);

  // Auto-focus the action button for keyboard accessibility
  const actionBtnEl = btnRow.querySelector('button:last-child') as HTMLButtonElement;
  actionBtnEl?.focus();
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
  // ── Confirmation dialogs: themed modal on web, native on mobile ──
  if (buttons && buttons.length > 1) {
    if (Platform.OS === 'web') {
      showWebDialog(title, message, buttons);
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
      showWebDialog(title, message, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'OK', onPress: () => resolve(true) },
      ]);
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
