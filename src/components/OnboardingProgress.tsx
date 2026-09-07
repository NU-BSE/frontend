import React from 'react';
import { StyleSheet, View } from 'react-native';

import { palette, radius, spacing } from '@/theme/tokens';

/**
 * A silent visual progress bar for onboarding.
 *
 * Deliberately has no "2 of 9" text: several steps can be skipped (auth for an
 * existing session, Connections entirely), so a hard step count would be a
 * lie. The fill just grows as the user moves forward.
 */
export function OnboardingProgress({ fraction }: { fraction: number }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View style={[styles.fill, { width: `${clamped * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.neutralWash,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: palette.brand,
  },
});

/** Fraction for each onboarding step, for callers that keep the layout here. */
export const ONBOARDING_PROGRESS: Record<string, number> = {
  welcome: 0,
  auth: 1 / 8,
  intent: 2 / 8,
  connections: 3 / 8,
  'ai-mode': 4 / 8,
  try: 5 / 8,
  feedback: 6 / 8,
  subscription: 7 / 8,
};

export const progressFor = (step: keyof typeof ONBOARDING_PROGRESS): number =>
  ONBOARDING_PROGRESS[step] ?? 0;

export const progressSpacing = spacing.sm;