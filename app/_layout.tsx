import React, { useEffect, useMemo } from "react";
import { Lora_400Regular } from "@expo-google-fonts/lora/400Regular";
import { Lora_600SemiBold } from "@expo-google-fonts/lora/600SemiBold";
import { Lora_700Bold } from "@expo-google-fonts/lora/700Bold";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AiProvider } from "@/ai/AiProvider";
import { AgentProvider } from "@/agent/AgentProvider";
import { AgentChatProvider } from "@/agent/AgentChatProvider";
import { AuthRouteGuard } from "@/auth/AuthRouteGuard";
import { registerAppMcpDependencies } from "@/mcp/app-dependencies";
import { palette } from "@/theme/tokens";

// Wire the persistent ConnectionStore + Keystore-backed CredentialVault
// before anything can touch the MCP runtime.
registerAppMcpDependencies();

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  /*
   * One serif family, three weights. React Native has no synthetic bolding on
   * Android — a missing weight silently renders as regular — so each weight is
   * loaded and named explicitly rather than relying on `fontWeight`.
   */
  const [fontsLoaded, fontError] = useFonts({
    Lora_400Regular,
    Lora_600SemiBold,
    Lora_700Bold,
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
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontError, fontsLoaded]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: palette.canvas }}
    >
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          {/* Legacy WebAuthGate (login/password) intentionally disabled. */}
          <AuthRouteGuard>
            <AiProvider>
              <AgentProvider>
                <AgentChatProvider>
                <StatusBar style="dark" />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: palette.canvas },
                  }}
                >
                  <Stack.Screen name="index" />
                  <Stack.Screen name="onboarding" />
                  <Stack.Screen name="auth" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen
                    name="chat"
                    options={{
                      presentation: "modal",
                      animation: "slide_from_bottom",
                    }}
                  />
                </Stack>
                </AgentChatProvider>
              </AgentProvider>
            </AiProvider>
          </AuthRouteGuard>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
