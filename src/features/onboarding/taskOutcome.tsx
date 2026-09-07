import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Bottom-of-chat outcomes for the onboarding first task.
 *
 * Shown only after a real agent run finishes. Success does not auto-close the
 * chat — the user must be able to read the result — so a "Continue setup" bar
 * sits above the composer until they choose to move on. A failed run offers a
 * retry, another task, or feedback instead of dropping the user at the paywall.
 */
export function TaskContinueBar({ onContinue }: { onContinue: () => void }) {
  return (
    <View style={styles.bar}>
      <Text variant="body" tone="secondary" style={styles.text}>
        Creepy finished your task.
      </Text>
      <Button label="Continue setup" onPress={onContinue} />
    </View>
  );
}

export function TaskFailureCard({
  onRetry,
  onChooseAnother,
  onTellUs,
  connectLabel,
  onConnect,
}: {
  onRetry: () => void;
  onChooseAnother: () => void;
  onTellUs: () => void;
  /** Present when the failure is one a connection would fix. */
  connectLabel?: string;
  onConnect?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text variant="headline">That didn&apos;t work</Text>
      <Text variant="body" tone="secondary">
        Creepy couldn&apos;t finish this one. Try again or pick something else.
      </Text>
      <View style={styles.actions}>
        {onConnect && connectLabel ? (
          <Button label={connectLabel} onPress={onConnect} />
        ) : null}
        <Button label="Try again" variant="secondary" onPress={onRetry} />
        <Button
          label="Choose another task"
          variant="secondary"
          onPress={onChooseAnother}
        />
        <Button label="Tell us what happened" variant="ghost" onPress={onTellUs} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
  },
  text: { textAlign: 'center' },
  card: { gap: spacing.md },
  actions: { gap: spacing.sm },
});