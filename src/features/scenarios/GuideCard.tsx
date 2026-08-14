import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import ArrowRight from '@assets/icons/arrow-right-blue.svg';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * One Android guide in the Settings feed.
 *
 * Deliberately lighter than ScenarioCard: there are thirty-six of these under
 * six headings, so each is a single line of title plus an affordance rather
 * than an icon well, description and tag. The title *is* the content — it is
 * already the question the user arrived with, and it is sent to the chat
 * verbatim.
 */
export function GuideCard({
  prompt,
  onPress,
}: {
  prompt: string;
  onPress: (prompt: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ask: ${prompt}`}
      onPress={() => onPress(prompt)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text variant="cardTitle" style={styles.title}>
        {prompt}
      </Text>
      <View style={styles.affordance}>
        <Icon source={ArrowRight} size={16} color={palette.brand} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    ...shadow.card,
  },
  // The title takes the remaining width so the arrow stays pinned right
  // however many lines the question wraps to.
  title: { flex: 1, minWidth: 0 },
  affordance: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8 },
});
