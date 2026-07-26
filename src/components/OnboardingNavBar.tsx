import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './Icon';
import { Text } from './Text';
import Check from '@assets/icons/check.svg';
import ChevronLeft from '@assets/icons/chevron-left.svg';
import ChevronRightWhite from '@assets/icons/chevron-right-white.svg';
import {
  MIN_TOUCH_TARGET,
  palette,
  radius,
  shadow,
  spacing,
} from '@/theme/tokens';

/**
 * The onboarding footer from the Figma frames: a ghost Back on the left and
 * a filled advance button on the right. The advance button's glyph differs
 * per step (chevron while advancing, checkmark on the final step), which the
 * design uses to signal "this one commits".
 */
export function OnboardingNavBar({
  onBack,
  onAdvance,
  advanceLabel,
  advanceIcon = 'chevron',
  advanceDisabled,
}: {
  onBack?: () => void;
  onAdvance: () => void;
  advanceLabel: string;
  advanceIcon?: 'chevron' | 'check';
  advanceDisabled?: boolean;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.xl }]}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Icon source={ChevronLeft} size={7} height={12} color={palette.textSecondary} />
          <Text variant="labelSmall" tone="secondary" uppercase style={styles.tracked}>
            Back
          </Text>
        </Pressable>
      ) : (
        // Reserves the slot so the advance button does not shift between steps.
        <View style={styles.backSpacer} />
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(advanceDisabled) }}
        disabled={advanceDisabled}
        onPress={onAdvance}
        style={({ pressed }) => [
          styles.advance,
          pressed && styles.pressed,
          advanceDisabled && styles.disabled,
        ]}
      >
        {advanceIcon === 'check' ? (
          <Icon source={Check} size={16} height={12} color={palette.white} />
        ) : (
          <Icon source={ChevronRightWhite} size={7} height={12} color={palette.white} />
        )}
        <Text variant="labelSmall" tone="inverse" uppercase style={styles.tracked}>
          {advanceLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingTop: spacing.xl,
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.borderFaint,
  },
  back: {
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
  },
  backSpacer: { width: 1 },
  advance: {
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.lg,
    backgroundColor: palette.brand,
    ...shadow.card,
  },
  tracked: { letterSpacing: 1.4 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
});
