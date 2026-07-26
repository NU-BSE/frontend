import React, { useEffect, useMemo } from 'react';
// Per-weight subpaths, not the package barrels. Importing from
// '@expo-google-fonts/noto-serif' pulls every weight into the bundle — that
// measured 55 TTFs for the six faces actually used.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { NotoSerif_400Regular } from '@expo-google-fonts/noto-serif/400Regular';
import { NotoSerif_600SemiBold } from '@expo-google-fonts/noto-serif/600SemiBold';
import { NotoSerif_700Bold } from '@expo-google-fonts/noto-serif/700Bold';
import { PublicSans_600SemiBold } from '@expo-google-fonts/public-sans/600SemiBold';
import { PublicSans_700Bold } from '@expo-google-fonts/public-sans/700Bold';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AiProvider } from '@/ai/AiProvider';
import { palette } from '@/theme/tokens';

// Held until fonts resolve. Without this the first frame renders in the
// system font and visibly reflows once Noto Serif lands.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    NotoSerif_400Regular,
    NotoSerif_600SemiBold,
    NotoSerif_700Bold,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
    Inter_400Regular,
  });

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
    [],
  );

  useEffect(() => {
    // Hide on error too — a font failure should degrade to system fonts,
    // not strand the user on a splash screen forever.
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontError, fontsLoaded]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.canvas }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AiProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: palette.canvas },
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="chat"
                options={{
                  // Slides up over the tabs — it is a task, not a destination.
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                }}
              />
            </Stack>
          </AiProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
