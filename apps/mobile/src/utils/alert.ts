// ============================================================
// OrgsLedger Mobile — Cross-Platform Alert Utility
// ============================================================

import { Alert, Platform } from 'react-native';

/**
 * Cross-platform alert that works on iOS, Android, and Web
 * Supports optional buttons array with onPress callbacks
 */
export function showAlert(
  title: string,
  message?: string,
  buttons?: Array<{ text: string; onPress?: () => void; style?: string }>
): void {
  if (Platform.OS === 'web') {
    if (buttons && buttons.length > 1) {
      // Multiple buttons = confirmation dialog — use window.confirm
      const confirmed = window.confirm(message ? `${title}\n\n${message}` : title);
      if (confirmed) {
        const actionBtn = buttons.find((b) => b.style !== 'cancel') || buttons[buttons.length - 1];
        actionBtn?.onPress?.();
      } else {
        const cancelBtn = buttons.find((b) => b.style === 'cancel');
        cancelBtn?.onPress?.();
      }
    } else if (buttons && buttons.length === 1) {
      // Single button = info alert with callback
      window.alert(message ? `${title}\n\n${message}` : title);
      buttons[0]?.onPress?.();
    } else {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
  } else {
    // Use React Native's Alert for native platforms
    if (buttons && buttons.length > 0) {
      Alert.alert(title, message, buttons as any);
    } else {
      Alert.alert(title, message);
    }
  }
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
