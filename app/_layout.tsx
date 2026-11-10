/** vCache_101 **/
import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { PrinterProvider } from "@/context/PrinterContext";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { initDb, checkDbIntegrity } from '@/lib/offlineDb';
import { initSync } from '@/lib/sync';
import * as SplashScreen from 'expo-splash-screen';

// If fonts or startup tasks take longer than this, stop waiting for them:
// the splash screen is hidden and the app renders with fallback system fonts
// (or a diagnostic screen) instead of hanging on the splash forever.
const STARTUP_TIMEOUT_MS = 15000;

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    const segs = segments as string[];
    const isLoginPage = segs.length === 0;

    if (!isAuthenticated && !isLoginPage) {
      router.replace('/');
    } else if (isAuthenticated && isLoginPage) {
      router.replace('/pos');
    }
  }, [isAuthenticated, isLoading, segments]);

  if (isLoading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="pos" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="sales" />
      <Stack.Screen name="messages" />
    </Stack>
  );
}

/**
 * Fallback screen shown only when startup never finished within
 * STARTUP_TIMEOUT_MS. Uses plain system fonts (no fontFamily) so it renders
 * correctly even when the custom fonts failed to load.
 */
function StartupTimeoutScreen() {
  return (
    <View style={styles.timeoutContainer}>
      <Text style={styles.timeoutTitle}>CrunchNum is taking too long to start</Text>
      <Text style={styles.timeoutBody}>
        Startup on this device did not finish within {STARTUP_TIMEOUT_MS / 1000} seconds.{'\n\n'}
        Please close the app completely and open it again.{'\n'}
        If this keeps happening, report code ST-1 to your administrator.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  timeoutContainer: {
    flex: 1,
    backgroundColor: '#0D1117',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  timeoutTitle: {
    color: '#E6EDF3',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  timeoutBody: {
    color: '#8B949E',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [appIsReady, setAppIsReady] = useState(false);
  const [startupTimedOut, setStartupTimedOut] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        initDb();
        // Run integrity check after DB init — detect corruption early
        const isHealthy = checkDbIntegrity();
        if (!isHealthy) {
          Alert.alert(
            'Database Warning',
            'The local database may be corrupted. Some sales records could be missing or inaccurate. Please contact your admin.',
            [{ text: 'OK' }]
          );
        }
        initSync();
      } catch (e) {
        console.warn('Initialization error:', e);
      } finally {
        setAppIsReady(true);
      }
    }
    prepare();
  }, []);

  // Startup watchdog: a font that never loads or a startup task that stalls
  // must never leave the user stuck on the splash screen forever.
  useEffect(() => {
    if (appIsReady && (fontsLoaded || !!fontError)) return;
    const timer = setTimeout(() => {
      console.warn('[Startup] Watchdog fired — proceeding without pending startup steps.',
        { appIsReady, fontsLoaded, fontError: fontError?.message });
      setStartupTimedOut(true);
    }, STARTUP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [appIsReady, fontsLoaded, fontError]);

  // Fonts that failed with an error fall back to the system font instead of
  // blocking startup; a font that never resolves is abandoned after the timeout.
  const isReady = appIsReady && (fontsLoaded || !!fontError || startupTimedOut);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync().catch((e) => {
        console.warn('[Startup] Failed to hide splash screen:', e);
      });
    }
  }, [isReady]);

  if (!isReady) {
    if (!startupTimedOut) return null;
    return <StartupTimeoutScreen />;
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CartProvider>
            <PrinterProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </PrinterProvider>
          </CartProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
