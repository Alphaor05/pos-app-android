/** vCache_101 **/
import React, { useEffect, useState } from "react";
import { Alert } from "react-native";
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
import { dlog } from '@/lib/debugLog';

SplashScreen.preventAutoHideAsync();
dlog('js bundle loaded');

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();

  dlog(`nav rendered: isLoading=${isLoading}, isAuthenticated=${isAuthenticated}`);

  useEffect(() => {
    dlog('nav effect running');
    if (isLoading) {
      dlog('nav waiting for auth');
      return;
    }

    const segs = segments as string[];
    const isLoginPage = segs.length === 0;

    dlog(`nav routing: isLoginPage=${isLoginPage}, isAuthenticated=${isAuthenticated}`);

    if (!isAuthenticated && !isLoginPage) {
      router.replace('/');
    } else if (isAuthenticated && isLoginPage) {
      router.replace('/pos');
    }
  }, [isAuthenticated, isLoading, segments]);

  if (isLoading) {
    dlog('nav returning null (loading)');
    return null;
  }

  dlog('nav rendering Stack');
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

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (fontsLoaded) {
    dlog('fonts loaded');
  }

  const [appIsReady, setAppIsReady] = useState(false);

  useEffect(() => {
    dlog('layout mounted');
    async function prepare() {
      console.log('[RootLayout] Starting app preparation');
      dlog('db init start');
      try {
        console.log('[RootLayout] Initializing database');
        initDb();
        console.log('[RootLayout] Database initialized');
        dlog('db init done');
        // Run integrity check after DB init — detect corruption early
        const isHealthy = checkDbIntegrity();
        console.log('[RootLayout] DB integrity check:', isHealthy);
        if (!isHealthy) {
          Alert.alert(
            'Database Warning',
            'The local database may be corrupted. Some sales records could be missing or inaccurate. Please contact your admin.',
            [{ text: 'OK' }]
          );
        }
        console.log('[RootLayout] Initializing sync');
        initSync();
        console.log('[RootLayout] Sync initialized');
      } catch (e) {
        console.error('[RootLayout] Initialization error:', e);
      } finally {
        console.log('[RootLayout] Setting appIsReady = true');
        setAppIsReady(true);
      }
    }
    prepare();
  }, []);

  useEffect(() => {
    if (fontsLoaded && appIsReady) {
      dlog('splash hide called');
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, appIsReady]);

  if (!fontsLoaded || !appIsReady) return null;

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
