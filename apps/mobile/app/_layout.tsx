// ============================================================
// OrgsLedger Mobile — Root Layout (Expo Router)
// ============================================================

import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../src/stores/auth.store';
import { Colors } from '../src/theme';
import { DrawerProvider } from '../src/contexts/DrawerContext';
import { NavigationDrawer } from '../src/components/NavigationDrawer';
import { HamburgerButton } from '../src/components/HamburgerButton';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

// Stripe is native-only — lazy-load to avoid web crash
let StripeProvider: React.ComponentType<any> | null = null;
if (Platform.OS !== 'web') {
  try {
    StripeProvider = require('@stripe/stripe-react-native').StripeProvider;
  } catch {}
}

// In production, set EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY in your environment
const STRIPE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
  ((__DEV__ as boolean) ? 'pk_test_placeholder' : '');

export default function RootLayout() {
  const loadUser = useAuthStore((s) => s.loadUser);

  useEffect(() => {
    loadUser().then(() => {
    }).catch(err => {
      console.error('[RootLayout] loadUser error:', err);
    });
  }, []);

  const content = (
    <DrawerProvider>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <NavigationDrawer />
        <View style={{ flex: 1 }}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: Colors.primary },
              headerTintColor: Colors.textWhite,
              headerTitleStyle: { fontWeight: '600' },
              headerBackTitleVisible: false,
              headerLeft: () => <HamburgerButton />,
              contentStyle: { backgroundColor: Colors.background },
              ...(Platform.OS === 'web' && {
                headerBackImageSource: undefined,
              }),
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="activate" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false, headerLeft: () => null, gestureEnabled: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="admin" options={{ headerShown: false }} />
            <Stack.Screen name="notifications" options={{ headerShown: false }} />
            <Stack.Screen name="organization" options={{ headerShown: false }} />
            <Stack.Screen name="chat/[channelId]" options={{ headerShown: false }} />
            <Stack.Screen name="meetings/[meetingId]" options={{ headerShown: false }} />
            <Stack.Screen name="meetings/create" options={{ headerShown: false }} />
            <Stack.Screen name="financials/history" options={{ headerShown: false }} />
            <Stack.Screen name="financials/donate/[campaignId]" options={{ headerShown: false }} />
            <Stack.Screen name="announcements" options={{ title: 'Announcements' }} />
            <Stack.Screen name="events" options={{ title: 'Events' }} />
            <Stack.Screen name="polls" options={{ title: 'Polls' }} />
            <Stack.Screen name="documents" options={{ title: 'Documents' }} />
            <Stack.Screen name="members" options={{ title: 'Members' }} />
            <Stack.Screen name="change-password" options={{ title: 'Change Password' }} />
          </Stack>
        </View>
      </View>
    </DrawerProvider>
  );

  // StripeProvider is native-only; skip on web
  if (StripeProvider) {
    return (
      <ErrorBoundary>
        <StripeProvider
          publishableKey={STRIPE_PUBLISHABLE_KEY}
          merchantIdentifier="merchant.com.orgsledger"
        >
          {content}
        </StripeProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      {content}
    </ErrorBoundary>
  );
}
