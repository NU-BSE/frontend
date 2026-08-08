import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AUTH_PROVIDERS } from "@/auth/providers";
import { clearAuthSession, getAuthenticatedEmail } from "@/auth/emailAuth";
import { useAi } from "@/ai/AiProvider";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { TopAppBar } from "@/components/TopAppBar";
import { getMemoryProfile, resetOnboarding } from "@/storage/prefs";
import { gutter, palette, radius, shadow, spacing } from "@/theme/tokens";

export default function Account() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { origin, status, degradedReason, deactivateEngine } = useAi();
  const [connectedIds, setConnectedIds] = useState<Set<string>>(() => {
    return new Set(
      AUTH_PROVIDERS.filter((p) => p.enabled).map((p) => p.id),
    );
  });

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

  const toggleConnector = (providerId: string) => {
    setConnectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

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
          {AUTH_PROVIDERS.map((provider) => {
            const connected = connectedIds.has(provider.id);
            return (
              <View key={provider.id} style={styles.provider}>
                <Button
                  label={connected ? `${provider.label} — Connected` : provider.label}
                  variant={connected ? "primary" : "secondary"}
                  disabled={!provider.enabled}
                  onPress={() => toggleConnector(provider.id)}
                />
                {!provider.enabled && provider.note ? (
                  <Text variant="bodySmall" tone="muted" style={styles.note}>{provider.note}</Text>
                ) : null}
              </View>
            );
          })}
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
  provider: { gap: spacing.xs },
  note: { paddingHorizontal: spacing.xs },
});
