import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { track } from '@/analytics';
import { useAi } from '@/ai/AiProvider';
import {
  getLocalModelReason,
  getLocalModelState,
  getRecommendedLocalProfile,
} from '@/ai/localModelState';
import { Icon } from '@/components/Icon';
import { OnboardingNavBar } from '@/components/OnboardingNavBar';
import { OnboardingProgress, progressFor } from '@/components/OnboardingProgress';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import CheckCircle from '@assets/icons/check-circle-filled.svg';
import {
  getDeviceAssessment,
  setAiModeDone,
  setMemoryProfile,
  type MemoryProfile,
} from '@/storage/prefs';
import { gutter, palette, radius, spacing } from '@/theme/tokens';

type AiMode = 'local' | 'cloud';

/**
 * Where should Creepy think?
 *
 * Two big choices — on this phone or cloud — with the technical detail that
 * used to clutter this screen (ABI, core count, StrongBox, integrity flags)
 * moved out of the main flow. Local availability is shown honestly: a device
 * that cannot run local inference, or that has no model weights on it, cannot
 * pick "On this phone" and sees why.
 */
export default function OnboardingMemory() {
  const router = useRouter();
  const { activateSelectedEngine } = useAi();
  const [choice, setChoice] = useState<AiMode>('cloud');
  const [saving, setSaving] = useState(false);
  const initializedChoice = useRef(false);

  const { data: assessment, isPending } = useQuery({
    queryKey: ['device-assessment'],
    queryFn: getDeviceAssessment,
    staleTime: Infinity,
  });

  const localState = useMemo(() => getLocalModelState(assessment ?? null), [assessment]);
  const localReason = useMemo(() => getLocalModelReason(assessment ?? null), [assessment]);
  const recommendedLocal = useMemo(
    () => getRecommendedLocalProfile(assessment ?? null),
    [assessment],
  );

  // Cloud is the safe default unless this device is genuinely capable.
  useEffect(() => {
    if (!isPending && !initializedChoice.current) {
      initializedChoice.current = true;
      setChoice(localState === 'available' ? 'local' : 'cloud');
    }
  }, [isPending, localState]);

  const localAvailable = localState === 'available' && recommendedLocal !== null;

  const profileForChoice = useCallback((): MemoryProfile => {
    if (choice === 'cloud') return 'cloud';
    return recommendedLocal ?? 'balanced';
  }, [choice, recommendedLocal]);

  const finish = useCallback(async () => {
    if (saving) return;
    setSaving(true);

    const profile = profileForChoice();
    await setMemoryProfile(profile);
    await setAiModeDone();
    void activateSelectedEngine(profile, assessment ?? null);

    track('onboarding_ai_mode_selected', {
      ai_mode: choice === 'cloud' ? 'cloud' : 'local',
    });

    setSaving(false);
    router.push('/onboarding/try');
  }, [activateSelectedEngine, assessment, choice, profileForChoice, router, saving]);

  const localSupportLine = isPending
    ? 'Checking this device…'
    : localState === 'available'
      ? 'Recommended for this device'
      : localState === 'download_required'
        ? "The local model isn't downloaded. Download the local model to use Creepy on this phone."
        : 'Not available on this device';

  const localTone = localAvailable ? 'brand' : 'danger';

  return (
    <Screen>
      <View style={styles.progressWrap}>
        <OnboardingProgress fraction={progressFor('ai-mode')} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text variant="display" style={styles.heading}>
            Where should Creepy think?
          </Text>
          <Text variant="bodyLarge" tone="secondary" style={styles.body}>
            Choose how Creepy processes your requests. You can change this
            later.
          </Text>
        </View>

        {isPending ? (
          <View style={styles.checking}>
            <ActivityIndicator color={palette.brand} />
            <Text variant="body" tone="secondary">
              Checking what this phone can run…
            </Text>
          </View>
        ) : null}

        <View style={styles.cards}>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: choice === 'local', disabled: !localAvailable }}
            accessibilityLabel="On this phone. AI runs directly on your Android."
            disabled={!localAvailable || saving}
            onPress={() => setChoice('local')}
            style={({ pressed }) => [
              styles.card,
              choice === 'local' && styles.cardActive,
              !localAvailable && styles.cardDisabled,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.cardHeader}>
              <Text variant="cardTitle">On this phone</Text>
              <Text variant="tag" tone="brand" uppercase>
                Private &amp; offline
              </Text>
            </View>
            <Text variant="body" tone="secondary">
              AI runs directly on your Android. No AI request needs to leave
              your phone.
            </Text>
            {!localAvailable && localReason ? (
              <Text variant="bodySmall" tone="danger">
                {localReason}
              </Text>
            ) : null}
            <View style={styles.cardFooter}>
              <Text variant="label" tone={localTone}>
                {localSupportLine}
              </Text>
              {choice === 'local' ? (
                <Icon source={CheckCircle} size={20} color={palette.brand} />
              ) : (
                <View style={styles.radioEmpty} />
              )}
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: choice === 'cloud' }}
            accessibilityLabel="Cloud. Uses Creepy's cloud AI."
            disabled={saving}
            onPress={() => setChoice('cloud')}
            style={({ pressed }) => [
              styles.card,
              choice === 'cloud' && styles.cardActive,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.cardHeader}>
              <Text variant="cardTitle">Cloud</Text>
              <Text variant="tag" tone="brand" uppercase>
                No download
              </Text>
            </View>
            <Text variant="body" tone="secondary">
              Uses Creepy&apos;s cloud AI. Works without downloading the local
              model.
            </Text>
            <View style={styles.cardFooter}>
              <Text variant="label" tone="secondary">
                Always available
              </Text>
              {choice === 'cloud' ? (
                <Icon source={CheckCircle} size={20} color={palette.brand} />
              ) : (
                <View style={styles.radioEmpty} />
              )}
            </View>
          </Pressable>
        </View>
      </ScrollView>

      <OnboardingNavBar
        onBack={() => router.back()}
        onAdvance={() => void finish()}
        advanceLabel={saving ? 'Saving' : 'Continue'}
        advanceDisabled={saving || isPending}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  progressWrap: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.lg,
  },
  content: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  intro: { alignItems: 'center', paddingBottom: spacing.xxl },
  heading: { textAlign: 'center', marginBottom: spacing.lg },
  body: { textAlign: 'center' },
  checking: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  cards: { gap: spacing.lg },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
  },
  cardActive: { borderColor: palette.brand, backgroundColor: palette.brandWash },
  cardDisabled: { opacity: 0.55 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  radioEmpty: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: palette.border,
  },
  pressed: { opacity: 0.85 },
});