import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { hasAuthSession } from "@/auth/emailAuth";
import { resolveNextOnboardingRoute } from "@/features/onboarding/state";
import { palette } from "@/theme/tokens";

/**
 * The single entry decision.
 *
 * - An existing user who finished onboarding goes straight to the feed.
 * - Everyone else resumes at the first incomplete onboarding step, so a
 *   restart, process death, OAuth redirect or network error never loses
 *   progress: a brand-new user lands on Welcome, a returning user resumes
 *   exactly where they left off.
 *
 * Auth is part of the query key because the correct step depends on it; the
 * `["onboarding-status", ...]` prefix keeps the existing invalidations (from
 * subscription completion and sign-out) working.
 */
export default function Index() {
  const auth = useQuery({
    queryKey: ["auth-session"],
    queryFn: hasAuthSession,
    staleTime: Infinity,
  });
  const route = useQuery({
    queryKey: ["onboarding-status", auth.data],
    queryFn: () => resolveNextOnboardingRoute(Boolean(auth.data)),
    enabled: !auth.isPending,
    staleTime: Infinity,
  });

  if (auth.isPending || route.isPending || !route.data) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={palette.brand} />
      </View>
    );
  }

  return <Redirect href={route.data} />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.canvas,
  },
});