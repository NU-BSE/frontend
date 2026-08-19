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
import { disconnectEverything } from "@/connections/connectionService";
import { CONNECTIONS_QUERY_KEY } from "@/connections/useConnections";
import { getMemoryProfile, resetOnboarding } from "@/storage/prefs";
import { clearHistory } from "@/storage/history";
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

  /**
   * Sign out leaves nothing behind.
   *
   * This used to be two buttons: "Sign out", which dropped the auth tokens
   * only, and "Replay onboarding", which reset the local flags. Neither
   * touched connections or the credential vault, so the next person through
   * onboarding inherited the previous account's linked services and their
   * secrets — on a shared or demo device, that is somebody else's Telegram
   * session still signed in.
   *
   * Order matters. Connections go first, because disconnecting runs each
   * connector's provider-side teardown and that has to happen while the app is
   * still holding the credentials it needs to do it.
   */
  const signOut = useMutation({
    mutationFn: async () => {
      await disconnectEverything();
      await clearAuthSession();
      await resetOnboarding();
      // Chat history is not a secret, but it is the previous account's
      // conversations, and leaving them for whoever onboards next is the same
      // problem as leaving their Telegram session.
      await clearHistory();
      await deactivateEngine();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
      await queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
      await queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      queryClient.removeQueries({ queryKey: ["authenticated-email"] });
      queryClient.removeQueries({ queryKey: ["memory-profile"] });
      queryClient.removeQueries({ queryKey: ["history"] });
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
          <Text variant="bodySmall" tone="muted">
            Signs out and clears this device: every connected service, every
            stored credential, and your on-device settings.
          </Text>
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
