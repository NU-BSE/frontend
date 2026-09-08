import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Text';
import { MIN_TOUCH_TARGET, palette, radius, spacing, typography } from '@/theme/tokens';

export function Composer({
  onSend,
  onStop,
  busy,
  disabled,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();

  const send = useCallback(() => {
    if (!trimmed || busy || disabled) return;
    onSend(trimmed);
    setValue('');
  }, [busy, disabled, onSend, trimmed]);

  return (
    <View style={styles.row}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder="Type into the dark…"
        placeholderTextColor={palette.textMuted}
        multiline
        maxLength={2000}
        editable={!disabled}
        onSubmitEditing={send}
        // Keeps the send affordance on the keyboard itself, which is how
        // Android users expect a single-line-ish composer to behave.
        blurOnSubmit={false}
        returnKeyType="send"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={busy ? 'Stop generating' : 'Send message'}
        onPress={busy ? onStop : send}
        disabled={!busy && (!trimmed || disabled)}
        style={({ pressed }) => [
          styles.action,
          busy ? styles.stop : styles.send,
          (!busy && !trimmed) || disabled ? styles.actionDisabled : null,
          pressed && styles.pressed,
        ]}
      >
        <Text variant="micro" tone="primary">
          {busy ? 'STOP' : 'SEND'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.hairline,
    backgroundColor: palette.surface,
  },
  input: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    // Caps growth at roughly five lines so the list never gets squeezed out.
    maxHeight: 132,
    color: palette.textPrimary,
    backgroundColor: palette.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairline,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    ...typography.body,
  },
  action: {
    height: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: { backgroundColor: palette.accent },
  stop: { backgroundColor: palette.danger },
  actionDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
