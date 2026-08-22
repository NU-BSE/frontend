import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import {
  getScreenContext,
  serializeScreenContext,
  type ScreenContext,
} from '@/assistant/assistantRole';
import { gutter, palette, radius, spacing } from '@/theme/tokens';

/**
 * Where the assistant session hands off.
 *
 * Reached through `creepyim://assist`, which AssistantSession opens after it
 * has captured the screen the user was looking at. The capture is collected
 * here rather than in the session because React Native may not have been
 * running when the session ran — the context is parked natively and read on
 * arrival.
 *
 * This is the seam where the agent will be wired in. For now it shows what was
 * captured, which is what makes the whole chain — role, invocation, session,
 * AssistStructure, bridge — verifiable on a real device rather than only in
 * theory.
 */
export default function AssistScreen() {
  const [context, setContext] = useState<ScreenContext | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const captured = await getScreenContext();
      if (cancelled) return;
      setContext(captured);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="display">Assist</Text>

        {!loaded ? (
          <Text variant="bodyLarge" tone="secondary">
            Reading the screen…
          </Text>
        ) : context ? (
          <>
            <Text variant="bodyLarge" tone="secondary">
              Creepy was opened over {context.packageName ?? 'another app'}.
            </Text>

            <View style={styles.card}>
              <Row label="App" value={context.packageName ?? '—'} />
              <Row label="Invoked by" value={context.showSource} />
              <Row label="Elements" value={String(context.nodes.length)} />
              {context.url ? <Row label="URL" value={context.url} /> : null}
              {context.truncated ? (
                <Row label="Note" value="the screen was cut off" />
              ) : null}
            </View>

            <Text variant="headline">What the agent would see</Text>
            <View style={styles.card}>
              <Text variant="bodySmall" tone="secondary">
                {serializeScreenContext(context)}
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text variant="bodyLarge" tone="secondary">
              No screen context arrived.
            </Text>
            {/* All three of these are ordinary, so none is phrased as a fault. */}
            <Text variant="bodySmall" tone="muted">
              That happens when Creepy was opened directly rather than as the
              assistant, when the device is set not to send screen content to
              the assistant, or when the capture has aged out.
            </Text>
          </>
        )}

        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="bodySmall" tone="muted">
        {label}
      </Text>
      <Text variant="labelSmall" tone="secondary" style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  value: { flexShrink: 1, textAlign: 'right' },
});
