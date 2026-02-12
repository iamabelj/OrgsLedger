// ============================================================
// Cross-platform Stripe hook
// Returns no-op stubs on web, real useStripe on native
// ============================================================

import { Platform } from 'react-native';

const noopSheet = async () => ({ error: undefined });

interface StripeHookResult {
  initPaymentSheet: (params: any) => Promise<{ error?: any }>;
  presentPaymentSheet: () => Promise<{ error?: any }>;
}

export function useStripeSafe(): StripeHookResult {
  if (Platform.OS === 'web') {
    return {
      initPaymentSheet: noopSheet,
      presentPaymentSheet: noopSheet,
    };
  }

  // On native, use the real hook
  try {
    const { useStripe } = require('@stripe/stripe-react-native');
    return useStripe();
  } catch {
    return {
      initPaymentSheet: noopSheet,
      presentPaymentSheet: noopSheet,
    };
  }
}
