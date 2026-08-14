import React from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import CreepyMascot from '@assets/icons/creepy-mascot.svg';
import HeaderPerson from '@assets/icons/header-person.svg';
import {
  MIN_TOUCH_TARGET,
  palette,
  radius,
  shadow,
  spacing,
} from '@/theme/tokens';

/**
 * The Figma header: account icon, wordmark, and the "Ask Creepy" pill.
 *
 * The pill is the primary entry into the chat, so it lives here rather than
 * on any one screen — Home and History both show it.
 */
export function TopAppBar({ scenarioId }: { scenarioId?: string }) {
  const router = useRouter();

  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account"
        hitSlop={12}
        onPress={() => router.push('/(tabs)/auth')}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      >
        <Icon source={HeaderPerson} size={16} color={palette.textSecondary} />
      </Pressable>

      <Text variant="wordmark" tone="brand">
        Creepy.IM
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ask Creepy"
        onPress={() =>
          router.push(
            scenarioId ? `/chat?scenario=${scenarioId}` : '/chat',
          )
        }
        style={({ pressed }) => [styles.askPill, pressed && styles.pressed]}
      >
        <View style={styles.mascotWell}>
          <CreepyMascot width={26} height={26} color={palette.onBrand} />
        </View>
        <Text variant="button" tone="inverse">
          Ask Creepy
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderFaint,
  },
  iconButton: {
    width: MIN_TOUCH_TARGET - 16,
    height: MIN_TOUCH_TARGET - 16,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.brand,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    ...shadow.raised,
  },
  // The mascot sits directly on the pill so the blue background stays seamless.
  // The well matches the glyph rather than padding it: the artwork is already
  // cropped to its bounding box, so extra room here only shrinks it optically.
  mascotWell: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.75 },
});
