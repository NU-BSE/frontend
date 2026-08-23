import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useVoiceSession, type VoicePhase } from '@/voice/useVoiceSession';
import { isOnDeviceRecognitionAvailable } from '@/voice/voice';
import {
  MIN_TOUCH_TARGET,
  gutter,
  palette,
  radius,
  spacing,
} from '@/theme/tokens';

/**
 * The spoken conversation.
 *
 * One control, whose meaning follows the phase: tap to speak, tap again to
 * finish early, tap to stop the reply. A separate stop button would be dead
 * most of the time and would put the two things the user might want at that
 * moment in different places.
 */
export default function VoiceScreen() {
  const session = useVoiceSession();
  const [onDevice, setOnDevice] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isOnDeviceRecognitionAvailable().then((available) => {
      if (!cancelled) setOnDevice(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const label = PHASE_LABEL[session.phase];
  const busy = session.phase !== 'idle' && session.phase !== 'error';

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="display">Talk to Creepy</Text>

        {!session.supported ? (
          <Text variant="bodyLarge" tone="danger">
            This build has no speech recognition. Rebuild the app with the voice
            module included.
          </Text>
        ) : (
          <>
            <Text variant="bodyLarge" tone="secondary">
              {label}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={busy ? 'Stop' : 'Start speaking'}
              accessibilityState={{ busy }}
              onPress={busy ? session.stop : session.start}
              style={({ pressed }) => [
                styles.mic,
                busy && styles.micActive,
                pressed && styles.pressed,
              ]}
            >
              <Text variant="display" tone={busy ? 'inverse' : 'brand'}>
                {busy ? '■' : '●'}
              </Text>
            </Pressable>

            {/* Reserve the row so the layout does not jump between phases. */}
            <View style={styles.transcript}>
              {session.transcript ? (
                <Text variant="quote" tone="primary">
                  “{session.transcript}”
                </Text>
              ) : (
                <Text variant="bodySmall" tone="faint">
                  {session.phase === 'listening' ? 'Listening…' : ' '}
                </Text>
              )}
            </View>

            {session.reply ? (
              <View style={styles.card}>
                <Text variant="bodySmall" tone="muted">
                  Creepy
                </Text>
                <Text variant="body" tone="primary">
                  {session.reply}
                </Text>
              </View>
            ) : null}

            {session.error ? (
              <Text variant="body" tone="danger">
                {session.error}
              </Text>
            ) : null}

            <View style={styles.card}>
              <Row
                label="Speak replies aloud"
                value={session.speechEnabled ? 'On' : 'Off'}
                onPress={() => session.setSpeechEnabled(!session.speechEnabled)}
              />
              <Row
                label="Recognition"
                value={
                  onDevice === null
                    ? '—'
                    : onDevice
                      ? 'On device'
                      : 'Uses the network'
                }
              />
            </View>

            {/*
              Stated rather than buried: on stock Android recognition is
              usually served by Google, so the audio leaves the device even
              though the rest of the assistant need not.
            */}
            {onDevice === false ? (
              <Text variant="bodySmall" tone="muted">
                This device transcribes speech on Google’s servers. What you say
                here leaves the device; typing in chat does not.
              </Text>
            ) : null}
          </>
        )}

        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const PHASE_LABEL: Record<VoicePhase, string> = {
  idle: 'Tap to speak.',
  'requesting-permission': 'Waiting for microphone access…',
  listening: 'Listening — tap again when you are done.',
  thinking: 'Thinking…',
  speaking: 'Speaking — tap to stop.',
  error: 'Something went wrong.',
};

function Row({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.row}>
      <Text variant="label">{label}</Text>
      <Text variant="labelSmall" tone="secondary">
        {value}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${value}.`}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
    alignItems: 'stretch',
  },
  mic: {
    alignSelf: 'center',
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 2,
    borderColor: palette.brand,
  },
  micActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  transcript: { minHeight: 56, justifyContent: 'center' },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.6 },
});
