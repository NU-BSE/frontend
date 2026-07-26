import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import ArrowRight from '@assets/icons/arrow-right-blue.svg';
import { ACCENT_STYLE, type Scenario } from './registry';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * The Home card. Tapping anywhere on it opens the chat scoped to that
 * scenario — the whole card is the target, not just the "Open" affordance,
 * which is both what the Figma name ("Button - Card N") implies and the
 * larger touch target.
 */
export function ScenarioCard({
  scenario,
  onPress,
}: {
  scenario: Scenario;
  onPress: (scenario: Scenario) => void;
}) {
  const accent = ACCENT_STYLE[scenario.accent];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${scenario.cardTitle}. ${scenario.cardDescription}`}
      onPress={() => onPress(scenario)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.iconWell, { backgroundColor: accent.wash }]}>
        <Icon source={scenario.Icon} size={17} color={accent.ink} />
      </View>

      <Text variant="cardTitle" style={styles.title}>
        {scenario.cardTitle}
      </Text>
      <Text variant="bodySmall" tone="secondary" style={styles.description}>
        {scenario.cardDescription}
      </Text>

      <View style={styles.footer}>
        <View style={[styles.tag, { backgroundColor: accent.wash }]}>
          <Text variant="tag" uppercase style={{ color: accent.ink }}>
            {scenario.tag}
          </Text>
        </View>

        <View style={styles.open}>
          <Text variant="labelSmall" style={{ color: accent.ink }}>
            Open
          </Text>
          <Icon source={ArrowRight} size={11} color={accent.ink} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.sm,
    padding: 17,
    ...shadow.card,
  },
  iconWell: {
    width: 32,
    height: 32,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { marginBottom: spacing.xs },
  description: { marginBottom: spacing.lg },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  open: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pressed: { opacity: 0.85 },
});
