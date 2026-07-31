import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { hasAuthSession } from "@/auth/emailAuth";
import { hasCompletedOnboarding } from "@/storage/prefs";
import { palette } from "@/theme/tokens";

export default function Index() {
  const onboarding = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: hasCompletedOnboarding,
    staleTime: Infinity,
  });
  const auth = useQuery({
    queryKey: ["auth-session"],
    queryFn: hasAuthSession,
    staleTime: Infinity,
  });

  if (onboarding.isPending || auth.isPending) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={palette.brand} />
      </View>
    );
  }

  if (!onboarding.data) return <Redirect href="/onboarding" />;
  if (!auth.data) return <Redirect href="/auth" />;
  return <Redirect href="/(tabs)/feed" />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.canvas,
  },
});
