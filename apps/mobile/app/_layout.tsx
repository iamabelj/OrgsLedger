// ============================================================
// OrgsLedger Mobile — Root Layout (Expo Router)
// ============================================================

import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { Platform, View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '../src/stores/auth.store';
import { Colors } from '../src/theme';
import { DrawerProvider, useDrawer } from '../src/contexts/DrawerContext';
import { NavigationDrawer } from '../src/components/NavigationDrawer';
import { SmartHeaderLeft } from '../src/components/SmartHeaderLeft';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { ToastContainer } from '../src/components/ui/Toast';

// Keep splash screen visible while we load fonts
SplashScreen.preventAutoHideAsync().catch(() => {});

// Stripe is native-only — lazy-load to avoid web crash
let StripeProvider: React.ComponentType<any> | null = null;
if (Platform.OS !== 'web') {
  try {
    StripeProvider = require('@stripe/stripe-react-native').StripeProvider;
  } catch {}
}

const STRIPE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
  ((__DEV__ as boolean) ? 'pk_test_placeholder' : '');

/** Inner layout that consumes drawer context for responsive sidebar spacing */
function AppShell() {
  const { drawerWidth, isDesktop } = useDrawer();

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: Colors.background, overflow: 'hidden' }}>
      {/* Sidebar takes fixed width on desktop, or is overlay on mobile */}
      <NavigationDrawer />

      {/* Main content area — flex: 1, shifts right on desktop when drawer is open */}
      <View style={{
        flex: 1,
        marginLeft: isDesktop ? 0 : 0, // drawer is inline on desktop, overlay on mobile
      }}>
        <StatusBar style="light" />
        <ToastContainer />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: Colors.primary },
            headerTintColor: Colors.textWhite,
            headerTitleStyle: { fontWeight: '600' },
            headerBackTitleVisible: false,
            headerLeft: () => <SmartHeaderLeft />,
            contentStyle: { backgroundColor: Colors.background },
            // Smooth transitions for page navigation
            ...(Platform.OS === 'web' && {
              headerBackImageSource: undefined,
              animation: 'fade' as const,
            }),
            ...(Platform.OS !== 'web' && {
              animation: 'slide_from_right' as const,
            }),
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="activate" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false, headerLeft: () => null, gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="admin" options={{ headerShown: false }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="organization" options={{ title: 'Join Organization' }} />
          <Stack.Screen name="announcements" options={{ title: 'Announcements' }} />
          <Stack.Screen name="meetings" options={{ title: 'Meetings' }} />
          <Stack.Screen name="meetings/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="events" options={{ title: 'Events' }} />
          <Stack.Screen name="polls" options={{ title: 'Polls' }} />
          <Stack.Screen name="documents" options={{ title: 'Documents' }} />
          <Stack.Screen name="records" options={{ title: 'Records' }} />
          <Stack.Screen name="members" options={{ title: 'Members' }} />
          <Stack.Screen name="change-password" options={{ title: 'Change Password' }} />
          <Stack.Screen name="legal" options={{ headerShown: false }} />
          <Stack.Screen name="verify-email" options={{ title: 'Verify Email' }} />
          <Stack.Screen name="create-org" options={{ title: 'Create Organization' }} />
          <Stack.Screen name="help" options={{ title: 'Help & Support' }} />
        </Stack>
      </View>
    </View>
  );
}

export default function RootLayout() {
  const loadUser = useAuthStore((s) => s.loadUser);

  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
  });

  useEffect(() => {
    loadUser().catch(() => {});
  }, []);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={Colors.highlight} />
      </View>
    );
  }

  const content = (
    <DrawerProvider>
      <AppShell />
    </DrawerProvider>
  );

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
