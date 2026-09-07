import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { track } from '@/analytics';
import { useAi } from '@/ai/AiProvider';
import {
  getModelOptionSupport,
  getRecommendedMemoryProfile,
} from '@/ai/deviceModelSelection';
import { getLocalModelReason, getLocalModelState } from '@/ai/localModelState';
import { useModelInstall } from '@/features/model/useModelInstall';
import { Button } from '@/components/Button';
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

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

/**
 * Where should Creepy think?
 *
 * Two big choices — on this phone or cloud — shown honestly. "On this phone"
 * is selectable only when it can really run: the device must support local
 * inference AND the weights must be here (or downloadable). A subscription
 * gate on the download is stated plainly, and the user is never led to believe
 * local inference is running when it is not.
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

  const { state: install, start, stop } = useModelInstall('on-device');

  const support = useMemo(
    () => getModelOptionSupport(assessment ?? null),
    [assessment],
  );
  const deviceSupported =
    support.find((option) => option.profile === 'on-device')?.supported ?? false;
  const localReason = useMemo(
    () => getLocalModelReason(assessment ?? null),
    [assessment],
  );
  const installed = install.phase === 'installed';
  const localState = getLocalModelState(assessment ?? null, installed);

  // Cloud is the safe default unless this device can actually run on-device.
  useEffect(() => {
    if (!isPending && !initializedChoice.current) {
      initializedChoice.current = true;
      setChoice(localState === 'available' ? 'local' : 'cloud');
    }
  }, [isPending, localState]);

  const downloadable =
    install.downloadAllowed && install.bundle != null;
  const subscriptionBlocked = install.blocker.kind === 'subscription';
  const offlineMessage =
    install.blocker.kind === 'offline' ? install.blocker.message : null;

  const localCardEnabled =
    deviceSupported && (installed || downloadable);

  const finish = useCallback(async () => {
    if (saving) return;
    if (choice === 'local' && !installed) return;
    setSaving(true);

    const profile: MemoryProfile = choice === 'local' ? 'on-device' : 'cloud';
    await setMemoryProfile(profile);
    await setAiModeDone();
    void activateSelectedEngine(profile, assessment ?? null);

    track('onboarding_ai_mode_selected', { ai_mode: choice });

    setSaving(false);
    router.push('/onboarding/try');
  }, [
    activateSelectedEngine,
    assessment,
    choice,
    installed,
    router,
    saving,
  ]);

  const localSupportLine = isPending
    ? 'Checking this device…'
    : localState === 'available'
      ? 'Recommended for this device'
      : localState === 'download_required' && subscriptionBlocked
        ? 'An active subscription is required to download the model.'
        : localState === 'download_required' && install.phase === 'downloading'
          ? 'Downloading…'
          : localState === 'download_required'
            ? 'Download the model to use Creepy on this phone.'
            : 'Not available on this device';

  const localTone =
    localState === 'available'
      ? 'brand'
      : localState === 'download_required'
        ? 'secondary'
        : 'danger';

  const percent = install.progress
    ? Math.round(install.progress.fraction * 100)
    : 0;

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
            accessibilityState={{ selected: choice === 'local', disabled: !localCardEnabled }}
            accessibilityLabel="On this phone. AI runs directly on your Android."
            disabled={!localCardEnabled || saving}
            onPress={() => setChoice('local')}
            style={({ pressed }) => [
              styles.card,
              choice === 'local' && styles.cardActive,
              !localCardEnabled && styles.cardDisabled,
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
            {!deviceSupported && localReason ? (
              <Text variant="bodySmall" tone="danger">
                {localReason}
              </Text>
            ) : null}
            {deviceSupported && !installed && subscriptionBlocked ? (
              <Text variant="bodySmall" tone="secondary">
                {install.bundle
                  ? `${formatBytes(install.bundle.totalBytes)} to download.`
                  : null}{' '}
                You&apos;ll be able to subscribe on the next screen.
              </Text>
            ) : null}
            {offlineMessage ? (
              <Text variant="bodySmall" tone="secondary">
                {offlineMessage}
              </Text>
            ) : null}

            {deviceSupported && !installed && downloadable && choice === 'local' ? (
              install.phase === 'downloading' ? (
                <View style={styles.downloadBox}>
                  <View style={styles.downloadRow}>
                    <Text variant="bodySmall" tone="secondary">
                      {install.progress
                        ? `${formatBytes(install.progress.receivedBytes)} of ${formatBytes(
                            install.progress.totalBytes,
                          )}`
                        : 'Downloading…'}
                    </Text>
                    <Text variant="bodySmall" tone="secondary">
                      {percent}%
                    </Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${percent}%` }]} />
                  </View>
                  <Button label="Stop download" variant="ghost" onPress={stop} />
                </View>
              ) : (
                <Button
                  label={`Download (${formatBytes(install.bundle!.totalBytes)})`}
                  onPress={start}
                />
              )
            ) : null}

            {install.phase === 'failed' ? (
              <Text variant="bodySmall" tone="danger">
                The download failed. Check your connection and try again.
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
        advanceDisabled={
          saving || isPending || (choice === 'local' && !installed)
        }
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
  downloadBox: { gap: spacing.md },
  downloadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.neutralWash,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: palette.brand,
  },
  pressed: { opacity: 0.85 },
});