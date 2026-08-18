import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAgentContext } from "@/agent/AgentProvider";
import { Button } from "@/components/Button";
import {
  hasPermission as hasNotificationPermission,
  requestPermission as requestNotificationPermission,
  showCard,
  dismiss as dismissCard,
} from "@/notifications/smartCards";
import { cardForNextCategory } from "@/prediction/schedule";
import type { ModelBundle } from "@/prediction/inference";
import MODEL_JSON from "@/prediction/fixtures/category_models.sample.json";

const MODEL_BUNDLE = MODEL_JSON as unknown as ModelBundle;
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { useConnections } from "@/connections/useConnections";
import { getLocalMcpRuntime, getRuntimeMode } from "@/mcp/runtime-singleton";
import { gutter, palette, radius, shadow, spacing } from "@/theme/tokens";

/**
 * Developer diagnostics for the agent stack (MCP health, registered tools,
 * active connections, model capabilities). Deliberately not reachable from
 * the chat screen — the MCP debug button no longer ships in the normal UI.
 * No tokens or secrets are displayed.
 */
/**
 * Post whatever the predictor says is due.
 *
 * Nothing about the card is written here: the category, the apps named and the
 * buttons all come from the user's own usage run through the frozen model. If
 * no category is due, nothing is posted — a card with no prediction behind it
 * would be an advertisement wearing a prediction's clothes.
 *
 * The history used here is the demo one; in the app it comes from the agent's
 * tool logs.
 */
async function postPredictedCard(
  setStatus: (value: string) => void,
): Promise<void> {
  try {
    const granted =
      (await hasNotificationPermission()) ||
      (await requestNotificationPermission());
    if (!granted) {
      setStatus("denied — enable notifications in system settings");
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const hour = 3600;
    const events = [
      { packageName: "org.telegram.messenger", at: now - 11 * hour },
      { packageName: "com.google.android.gm", at: now - 8 * hour },
      { packageName: "org.telegram.messenger", at: now - 4 * hour },
      { packageName: "org.telegram.messenger", at: now - 1 * hour },
    ];

    const card = cardForNextCategory(MODEL_BUNDLE, events, now);
    if (!card) {
      setStatus("nothing predicted as due — no card posted");
      return;
    }

    await showCard(card);
    setStatus("posted from prediction");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "failed");
  }
}

export default function Diagnostics() {
  const [cardStatus, setCardStatus] = useState("idle");
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { modelId, capabilities } = useAgentContext();
  const { data: connections } = useConnections();

  const runtimeQuery = useQuery({
    queryKey: ["mcp-runtime"],
    queryFn: () => getLocalMcpRuntime(),
    staleTime: Infinity,
  });

  const healthQuery = useQuery({
    queryKey: ["mcp-health"],
    queryFn: async () => (await runtimeQuery.data!.mcp.health()).status,
    enabled: Boolean(runtimeQuery.data),
  });

  const toolsQuery = useQuery({
    queryKey: ["mcp-tools"],
    queryFn: async () => {
      const tools = await runtimeQuery.data!.mcp.listTools();
      return tools.map((tool) => tool.name).sort();
    },
    enabled: Boolean(runtimeQuery.data),
  });

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxxl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text variant="headline">Agent diagnostics</Text>
          <Button label="Back" variant="ghost" onPress={() => router.back()} />
        </View>

        <Section title="Notification cards">
          <Row label="Permission" value={cardStatus} />
          <Button
            label="Post predicted card"
            variant="secondary"
            onPress={() => void postPredictedCard(setCardStatus)}
          />
          <Button label="Dismiss card" variant="ghost" onPress={() => dismissCard()} />
        </Section>

        <Section title="MCP runtime">
          <Row label="Mode" value={getRuntimeMode() ?? "not initialized"} />
          <Row label="Health" value={healthQuery.data ?? (healthQuery.isError ? "error" : "checking…")} highlight={healthQuery.data === "ok"} />
          <Row label="Registered tools" value={toolsQuery.data ? String(toolsQuery.data.length) : "…"} />
        </Section>

        <Section title="Model">
          <Row label="Planner" value={modelId} />
          <Row label="Text generation" value={String(capabilities.textGeneration)} />
          <Row label="Tool calling" value={String(capabilities.toolCalling)} />
          <Row label="Structured output" value={String(capabilities.structuredOutput)} />
        </Section>

        <Section title="Connections">
          {connections && connections.length > 0 ? (
            connections.map((connection) => (
              <Row
                key={connection.id}
                label={connection.id}
                value={connection.status}
                highlight={connection.status === "connected"}
                danger={connection.status !== "connected"}
              />
            ))
          ) : (
            <Text variant="bodySmall" tone="muted">No connections</Text>
          )}
        </Section>

        <Section title="Tools">
          {toolsQuery.data ? (
            <Text variant="bodySmall" tone="secondary" style={styles.toolList}>
              {toolsQuery.data.join("\n")}
            </Text>
          ) : (
            <Text variant="bodySmall" tone="muted">Loading…</Text>
          )}
        </Section>
      </ScrollView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="headline">{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  section: { gap: spacing.md },
  card: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.borderSoft, padding: spacing.lg, gap: spacing.sm, ...shadow.card },
  cardRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  toolList: { lineHeight: 18 },
});
