import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clearAuthSession, getAuthenticatedEmail } from "@/auth/emailAuth";
import { useAi } from "@/ai/AiProvider";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { TopAppBar } from "@/components/TopAppBar";
import { ConnectorList } from "@/features/connections/ConnectorList";
import { getMemoryProfile, resetOnboarding } from "@/storage/prefs";
import { gutter, palette, radius, shadow, spacing } from "@/theme/tokens";

export default function Account() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { origin, status, degradedReason, deactivateEngine } = useAi();

  const { data: email } = useQuery({
    queryKey: ["authenticated-email"],
    queryFn: getAuthenticatedEmail,
  });
  const { data: memoryProfile } = useQuery({
    queryKey: ["memory-profile"],
    queryFn: getMemoryProfile,
  });

  const signOut = useMutation({
    mutationFn: clearAuthSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
      queryClient.removeQueries({ queryKey: ["authenticated-email"] });
      router.replace("/auth");
    },
  });

  const replay = useMutation({
    mutationFn: resetOnboarding,
    onSuccess: async () => {
      await deactivateEngine();
      await queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
      router.replace("/onboarding");
    },
  });

  return (
    <Screen>
      <TopAppBar />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxxl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text variant="headline">Account</Text>
          <View style={styles.card}>
            <Row label="Signed in as" value={email ?? "—"} />
            <Row label="Method" value="Email code" highlight />
          </View>
          <Button label="Sign out" variant="secondary" loading={signOut.isPending} onPress={() => signOut.mutate()} />
        </View>

        <View style={styles.section}>
          <Text variant="headline">Connectors</Text>
          <ConnectorList />
        </View>

        <View style={styles.section}>
          <Text variant="headline">Intelligence</Text>
          <View style={styles.card}>
            <Row label="Runs" value={origin} highlight={origin === "on-device"} />
            <Row label="Status" value={status} danger={status === "degraded"} />
            <Row label="Memory profile" value={memoryProfile ?? "—"} />
            {degradedReason ? <Text variant="bodySmall" tone="danger">{degradedReason}</Text> : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text variant="headline">Developer</Text>
          <Button label="Agent diagnostics" variant="secondary" onPress={() => router.push("/dev/diagnostics")} />
          <Button label="Replay onboarding" variant="secondary" loading={replay.isPending} onPress={() => replay.mutate()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value, highlight, danger }: { label: string; value: string; highlight?: boolean; danger?: boolean }) {
  return (
    <View style={styles.cardRow}>
      <Text variant="bodySmall" tone="muted">{label}</Text>
      <Text variant="labelSmall" tone={danger ? "danger" : highlight ? "brand" : "secondary"}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: gutter.screen, paddingTop: spacing.xl, gap: spacing.xxl },
  section: { gap: spacing.md },
  card: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.borderSoft, padding: spacing.lg, gap: spacing.sm, ...shadow.card },
  cardRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
});
