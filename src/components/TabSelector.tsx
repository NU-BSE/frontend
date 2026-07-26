import React from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text } from './Text';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

export interface TabOption {
  id: string;
  label: string;
}

/**
 * The horizontal scroller from Home. The Figma frame clips the last tab at
 * the right edge, which is the design telling us it scrolls — so it does,
 * rather than being squeezed to fit.
 */
export function TabSelector({
  options,
  value,
  onChange,
}: {
  options: TabOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.id)}
            style={({ pressed }) => [
              styles.chip,
              active ? styles.chipActive : styles.chipInactive,
              pressed && styles.pressed,
            ]}
          >
            <Text variant="label" tone={active ? 'inverse' : 'secondary'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: radius.lg,
    ...shadow.card,
  },
  chipActive: { backgroundColor: palette.brand },
  chipInactive: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  pressed: { opacity: 0.8 },
});
