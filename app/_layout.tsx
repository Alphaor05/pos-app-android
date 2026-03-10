import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { BluetoothProvider } from "@/context/BluetoothContext";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useEffect } from 'react';
import { initDb } from '@/lib/offlineDb';
import { initSync } from '@/lib/sync';

SplashScreen.preventAutoHideAsync();

import { useAuth } from "@/context/AuthContext";
import { router, useSegments } from "expo-router";

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    // Type-cast segments to string[] to avoid strict route-type overlap errors
    const segs = segments as string[];
    const isLoginPage = segs.length === 0;

    if (!isAuthenticated && !isLoginPage) {
      // Redirect to login if not authenticated and trying to access private route
      router.replace('/');
    } else if (isAuthenticated && isLoginPage) {
      // Redirect to pos if authenticated and on login page
      router.replace('/pos');
    }
  }, [isAuthenticated, isLoading, segments]);

  if (isLoading) return null; // Or a splash screen component

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="pos" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="sales" />
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

  const [appIsReady, setAppIsReady] = React.useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        // prepare local storage and background sync
        initDb();
        initSync();
        // Pre-load any other resources if needed
      } catch (e) {
        console.warn('Initialization error:', e);
      } finally {
        setAppIsReady(true);
      }
    }

    prepare();
  }, []);

  useEffect(() => {
    if (fontsLoaded && appIsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, appIsReady]);

  if (!fontsLoaded || !appIsReady) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CartProvider>
            <BluetoothProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </BluetoothProvider>
          </CartProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
