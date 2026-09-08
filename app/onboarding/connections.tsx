import React, { useCallback, useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { track } from "@/analytics";
import { Button } from "@/components/Button";
import { OnboardingNavBar } from "@/components/OnboardingNavBar";
import { OnboardingProgress, progressFor } from "@/components/OnboardingProgress";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import {
  useConnectConnector,
  useConnection,
  useConnections,
} from "@/connections/useConnections";
import { getSelectedIntents, setConnectionsDone } from "@/storage/prefs";
import { gutter, palette, radius, spacing } from "@/theme/tokens";
import type { OnboardingIntentId } from "@/storage/prefs";

const PROVIDER_FOR_CONNECTOR: Record<string, string> = {
  android: "android",
  "telegram-user": "telegram",
  google: "google",
};

/**
 * Connections during onboarding.
 *
 * Contextual, not a permission dump: This phone is always offered (its
 * sensitive permissions are requested later, only when a feature needs them);
 * Telegram appears for the Messages interest; Google for email/calendar/drive.
 * Nothing here is required to continue.
 */
export default function OnboardingConnections() {
  const router = useRouter();
  const connect = useConnectConnector();
  const { connection: android } = useConnection("android");
  const { connection: telegram } = useConnection("telegram-user");
  const { connection: google } = useConnection("google");
  const { data: connections } = useConnections();

  const [intents, setIntents] = React.useState<OnboardingIntentId[]>([]);
  useEffect(() => {
    let cancelled = false;
    void getSelectedIntents().then((ids) => {
      if (!cancelled) setIntents(ids);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track("onboarding_connections_viewed");
  }, []);

  // Telegram / Google only become connected via their real connect screens,
  // so the first time we see them connected here is a completed connection.
  const completedTracked = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const record of connections ?? []) {
      if (record.status !== "connected") continue;
      if (record.connectorId === "android") continue;
      if (completedTracked.current.has(record.connectorId)) continue;
      const provider = PROVIDER_FOR_CONNECTOR[record.connectorId];
      if (!provider) continue;
      completedTracked.current.add(record.connectorId);
      track("onboarding_connection_completed", { provider });
    }
  }, [connections]);

  const connectAndroid = useCallback(() => {
    track("onboarding_connection_started", { provider: "android" });
    void connect
      .mutateAsync("android")
      .then(() => {
        completedTracked.current.add("android");
        track("onboarding_connection_completed", { provider: "android" });
      })
      .catch(() => undefined);
  }, [connect]);

  const startTelegram = useCallback(() => {
    track("onboarding_connection_started", { provider: "telegram" });
    router.push("/connect/telegram");
  }, [router]);

  const startGoogle = useCallback(() => {
    track("onboarding_connection_started", { provider: "google" });
    router.push("/connect/google");
  }, [router]);

  const finish = useCallback(async () => {
    await setConnectionsDone();
    router.push("/onboarding/memory");
  }, [router]);

  const wantsTelegram = intents.includes("messages");
  const wantsGoogle = ["email", "calendar", "drive"].some((id) =>
    intents.includes(id as OnboardingIntentId),
  );

  return (
    <Screen>
      <View style={styles.progressWrap}>
        <OnboardingProgress fraction={progressFor("connections")} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text variant="display" style={styles.heading}>
            Give Creepy something to work with
          </Text>
          <Text variant="bodyLarge" tone="secondary" style={styles.body}>
            Creepy only gets access to what you connect. You can add or remove
            access anytime.
          </Text>
        </View>

        <View style={styles.cards}>
          <ConnectionCard
            title="This phone"
            badge="Recommended"
            description="Open the right Android settings, understand your device and control supported options."
            connected={android?.status === "connected"}
            connectLabel="Connect this phone"
            connecting={connect.isPending}
            onConnect={connectAndroid}
          />

          {wantsTelegram ? (
            <ConnectionCard
              title="Telegram"
              description="Find chats, catch up on messages and send replies."
              note="Creepy always asks before sending a message."
              connected={telegram?.status === "connected"}
              connectLabel="Connect Telegram"
              onConnect={startTelegram}
            />
          ) : null}

          {wantsGoogle ? (
            <ConnectionCard
              title="Google"
              description="Calendar, Drive and Gmail."
              note="Calendar and Drive start read-only. Gmail access is requested only when you use an email feature."
              connected={google?.status === "connected"}
              connectLabel="Connect Google"
              onConnect={startGoogle}
            />
          ) : null}
        </View>

        {android?.status === "connected" ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/connect/android")}
            style={({ pressed }) => [
              styles.deviceAccess,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.deviceAccessCopy}>
              <Text variant="label" tone="brand">
                Set up device access
              </Text>
              <Text variant="bodySmall" tone="secondary">
                Modify system settings, usage access, notifications and the
                assistant — each asked for only when you want it.
              </Text>
            </View>
            <Text variant="label" tone="faint">
              ›
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => void finish()}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Text variant="label" tone="secondary">
            I&apos;ll do this later
          </Text>
        </Pressable>
      </ScrollView>

      <OnboardingNavBar
        onBack={() => router.back()}
        onAdvance={() => void finish()}
        advanceLabel="Continue"
      />
    </Screen>
  );
}

function ConnectionCard({
  title,
  badge,
  description,
  note,
  connected,
  connectLabel,
  connecting,
  onConnect,
}: {
  title: string;
  badge?: string;
  description: string;
  /**
   * A second paragraph, for what Creepy will not do without being asked.
   *
   * Its own prop rather than "\n\n" inside `description`: a JSX string
   * attribute is not a JS string literal and does not process escapes, so
   * that rendered the backslashes verbatim on screen. Writing it as
   * `{"...\n\n..."}` would fix the escape but still stack two lines at the
   * body line-height, whereas the card is a flex column with a gap and gives
   * a real paragraph break to anything rendered as its own block.
   */
  note?: string;
  connected?: boolean;
  connectLabel: string;
  connecting?: boolean;
  onConnect?: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text variant="cardTitle">{title}</Text>
        {badge ? (
          <Text variant="tag" tone="brand" uppercase>
            {badge}
          </Text>
        ) : null}
      </View>
      <Text variant="bodySmall" tone="secondary">
        {description}
      </Text>
      {note ? (
        <Text variant="bodySmall" tone="secondary">
          {note}
        </Text>
      ) : null}
      {connected ? (
        <Text variant="label" tone="brand">
          Connected
        </Text>
      ) : (
        <Button
          label={connectLabel}
          variant="secondary"
          loading={connecting}
          disabled={connecting}
          onPress={onConnect}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  progressWrap: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.lg,
  },
  content: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  intro: { alignItems: "center", paddingBottom: spacing.xxl },
  heading: { textAlign: "center", marginBottom: spacing.lg },
  body: { textAlign: "center" },
  cards: { gap: spacing.lg },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  skip: {
    alignSelf: "center",
    marginTop: spacing.xl,
    padding: spacing.md,
  },
  deviceAccess: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    minHeight: 56,
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: palette.brand,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  deviceAccessCopy: { flex: 1, gap: spacing.xs },
  pressed: { opacity: 0.7 },
});