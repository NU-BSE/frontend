import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Text';
import {
  MIN_TOUCH_TARGET,
  palette,
  radius,
  shadow,
  spacing,
  typography,
} from '@/theme/tokens';

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
  const canSend = Boolean(trimmed) && !busy && !disabled;

  const send = useCallback(() => {
    if (!canSend) return;
    onSend(trimmed);
    setValue('');
  }, [canSend, onSend, trimmed]);

  return (
    <View style={styles.row}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder="Say something…"
        placeholderTextColor={palette.textMuted}
        multiline
        maxLength={2000}
        editable={!disabled}
        onSubmitEditing={send}
        submitBehavior="submit"
        returnKeyType="send"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={busy ? 'Stop generating' : 'Send message'}
        onPress={busy ? onStop : send}
        disabled={!busy && !canSend}
        style={({ pressed }) => [
          styles.action,
          busy ? styles.stop : styles.send,
          !busy && !canSend && styles.actionDisabled,
          pressed && styles.pressed,
        ]}
      >
        <Text variant="labelSmall" tone="inverse">
          {busy ? 'Stop' : 'Send'}
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
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.borderFaint,
  },
  input: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    // Caps growth at roughly five lines so the transcript is never squeezed out.
    maxHeight: 132,
    color: palette.textPrimary,
    backgroundColor: palette.canvas,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderFaint,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
  },
  action: {
    height: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  send: { backgroundColor: palette.brand },
  stop: { backgroundColor: palette.textSecondary },
  actionDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
