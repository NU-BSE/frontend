import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * The "options to choose from" half of the chat.
 *
 * Chips wrap rather than scroll horizontally: a suggestion the user cannot
 * see is a suggestion that does not exist, and these are the primary way
 * into a conversation for someone who does not know what to type.
 */
export function SuggestionChips({
  suggestions,
  onSelect,
  disabled,
}: {
  suggestions: string[];
  onSelect: (text: string) => void;
  disabled?: boolean;
}) {
  if (suggestions.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {suggestions.map((suggestion) => (
        <Pressable
          key={suggestion}
          accessibilityRole="button"
          accessibilityLabel={`Ask: ${suggestion}`}
          disabled={disabled}
          onPress={() => onSelect(suggestion)}
          style={({ pressed }) => [
            styles.chip,
            pressed && styles.pressed,
            disabled && styles.disabled,
          ]}
        >
          <Text variant="labelSmall" tone="brand">
            {suggestion}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.brandHairline,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadow.card,
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
});
