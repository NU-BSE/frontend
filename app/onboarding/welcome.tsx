import React, { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics';
import { Button } from '@/components/Button';
import { OnboardingProgress, progressFor } from '@/components/OnboardingProgress';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { setWelcomeCompleted } from '@/storage/prefs';
import { gutter, palette, radius, shadow, spacing } from '@/theme/tokens';
import CreepyMascot from '@assets/icons/creepy-mascot.svg';

/**
 * The single, non-carousel opening screen.
 *
 * One screen, minimum copy, one CTA. The value proposition is Creepy's actual
 * difference ("can act, not just answer") rather than three marketing slides.
 */
export default function OnboardingWelcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const started = useRef(false);

  const getStarted = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    await setWelcomeCompleted();
    track('onboarding_started');
    track('onboarding_welcome_completed');
    router.replace('/onboarding');
  }, [router]);

  return (
    <Screen>
      <View style={styles.progressWrap}>
        <OnboardingProgress fraction={progressFor('welcome')} />
      </View>
      <View style={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
        <View style={styles.intro}>
          <View style={styles.mascotFrame}>
            <CreepyMascot width={72} height={72} color={palette.brand} />
          </View>
          <Text variant="wordmark" style={styles.wordmark}>
            Creepy
          </Text>
          <Text variant="headline" tone="secondary" style={styles.tagline}>
            Your Android can do more than you think.
          </Text>
          <Text variant="body" tone="secondary" style={styles.body}>
            Ask Creepy to fix settings, find things across your apps, catch you
            up, or take care of simple actions.
          </Text>
          <Text variant="body" tone="secondary" style={styles.body}>
            Creepy can act, not just answer. You approve important actions
            before they happen.
          </Text>
        </View>

        <Button label="Get started" onPress={() => void getStarted()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progressWrap: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.lg,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.xxl,
    paddingHorizontal: gutter.screen,
    paddingVertical: spacing.xxxl,
  },
  intro: { alignItems: 'center' },
  mascotFrame: {
    width: 112,
    height: 112,
    marginBottom: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.borderFaint,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    ...shadow.card,
  },
  wordmark: { marginBottom: spacing.lg },
  tagline: { marginBottom: spacing.lg, textAlign: 'center' },
  body: { textAlign: 'center', marginBottom: spacing.xs },
});