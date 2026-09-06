import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getModelCatalog } from '@/api/client';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { useAi } from '@/ai/AiProvider';
import {
  getModelOptionSupport,
  getRecommendedMemoryProfile,
} from '@/ai/deviceModelSelection';
import { Icon } from '@/components/Icon';
import { OnboardingNavBar } from '@/components/OnboardingNavBar';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import CheckCircle from '@assets/icons/check-circle-filled.svg';
import {
  getDeviceAssessment,
  setMemoryProfile,
  setOnboardingComplete,
  type MemoryProfile,
} from '@/storage/prefs';
import { gutter, palette, radius, spacing } from '@/theme/tokens';

/*
 * One local option and one remote one. The three size tiers this replaced each
 * ran a different student model; there is one local model now, and three names
 * for it would be a menu that misleads.
 *
 * The local row does not name the model. It said "2B", which was true of the
 * model the app happened to be written against and became a lie the moment the
 * backend published a different one — the app downloads whatever the catalogue
 * offers. The catalogue's own size is shown instead, which stays true whatever
 * is served, and reads as the thing a user actually weighs.
 */
const OPTIONS: {
  id: MemoryProfile;
  label: string;
  value: string;
}[] = [
  { id: 'on-device', label: 'On this device', value: 'Private, offline' },
  { id: 'cloud', label: 'Cloud only', value: 'Nothing is downloaded' },
];

const formatBytes = (bytes?: number): string => {
  if (typeof bytes !== 'number') return 'Unknown';
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

/**
 * Processor description from what Android actually exposes: core count and the
 * primary ABI. Both gate local execution — cores set the speed floor, and a
 * non-arm64 ABI rules local models out entirely — so the screen that disables
 * profiles should show the numbers that did the disabling.
 */
const formatProcessor = (cores?: number, abis?: string[]): string => {
  const arch = abis?.find((abi) => /arm64|aarch64/iu.test(abi)) ?? abis?.[0];
  if (typeof cores !== 'number') return arch ?? 'Unknown CPU';
  return arch ? `${cores}-core ${arch}` : `${cores}-core CPU`;
};

export default function OnboardingMemory() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activateSelectedEngine } = useAi();
  const [choice, setChoice] = useState<MemoryProfile>('cloud');
  const initializedChoice = useRef(false);

  const { data: assessment, isPending } = useQuery({
    queryKey: ['device-assessment'],
    queryFn: getDeviceAssessment,
    staleTime: Infinity,
  });

  /*
   * What the backend actually publishes, so the storage requirement is the
   * size of this download rather than a constant measured from one model.
   * Best-effort: an unreachable catalogue leaves the fallback in place instead
   * of blocking the screen.
   */
  const { data: catalog } = useQuery({
    queryKey: ['model-catalog'],
    queryFn: getModelCatalog,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const localBundle = catalog?.bundles.find(
    (bundle) => bundle.profile === 'on-device',
  );

  const support = useMemo(
    () => getModelOptionSupport(assessment ?? null, localBundle?.totalBytes),
    [assessment, localBundle?.totalBytes],
  );

  useEffect(() => {
    if (!isPending && !initializedChoice.current) {
      initializedChoice.current = true;
      setChoice(getRecommendedMemoryProfile(assessment ?? null));
    }
  }, [assessment, isPending]);

  const finish = useCallback(async () => {
    const selectedSupport = support.find((option) => option.profile === choice);
    if (!selectedSupport?.supported) return;

    await setMemoryProfile(choice);
    void activateSelectedEngine(choice, assessment ?? null);
    /*
     * Onboarding is completed by the subscription step, not here — marking it
     * done now would let the guard treat the run as finished and skip the
     * paywall on the next launch.
     */
    router.push('/onboarding/subscription');
  }, [activateSelectedEngine, assessment, choice, queryClient, router, support]);

  const summary =
    assessment?.platform === 'android'
      ? `${assessment.hardware.model ?? 'Android device'} · ${formatProcessor(
          assessment.hardware.cpuCoreCount,
          assessment.hardware.supportedAbis,
        )} · ${formatBytes(
          assessment.hardware.totalMemoryBytes,
        )} RAM · ${formatBytes(
          assessment.hardware.availableStorageBytes,
        )} free`
      : 'The native device assessment was unavailable.';

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="display" style={styles.heading}>
          Configure Local Intelligence
        </Text>
        <Text variant="bodyLarge" tone="secondary" style={styles.description}>
          Choose a model profile after the device integrity and capacity check.
          Unsupported profiles are disabled automatically.
        </Text>

        <View style={styles.deviceCard} accessibilityLiveRegion="polite">
          {isPending ? (
            <ActivityIndicator color={palette.brand} />
          ) : (
            <>
              <View style={styles.deviceCardHeader}>
                <Text variant="label">Device assessment</Text>
                <Text
                  variant="tag"
                  tone={
                    assessment?.platform === 'android' &&
                    assessment.integrity.status === 'trusted'
                      ? 'brand'
                      : 'danger'
                  }
                  uppercase
                >
                  {assessment?.platform === 'android'
                    ? assessment.integrity.status
                    : 'unavailable'}
                </Text>
              </View>
              <Text variant="bodySmall" tone="secondary">
                {summary}
              </Text>
              {assessment?.platform === 'android' ? (
                <Text variant="bodySmall" tone="secondary">
                  {assessment.keystore.hardwareBacked
                    ? assessment.keystore.strongBoxBacked
                      ? 'StrongBox-backed key attestation passed.'
                      : 'Hardware-backed Android Keystore attestation passed.'
                    : 'Hardware key attestation was unavailable.'}
                </Text>
              ) : null}
            </>
          )}
        </View>

        <View style={styles.options}>
          {OPTIONS.map((option) => {
            const optionSupport = support.find(
              (candidate) => candidate.profile === option.id,
            );
            const supported = optionSupport?.supported ?? false;
            const active = option.id === choice;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, disabled: !supported }}
                accessibilityLabel={`${option.label}, ${option.value}. ${
                  optionSupport?.reason ?? ''
                }`}
                disabled={!supported || isPending}
                onPress={() => setChoice(option.id)}
                style={({ pressed }) => [
                  styles.row,
                  active && styles.rowActive,
                  !supported && styles.rowDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.rowText}>
                  <View style={styles.optionHeading}>
                    <Text variant="overline" tone="secondary" uppercase>
                      {option.label}
                    </Text>
                    {optionSupport?.recommended ? (
                      <Text variant="tag" tone="brand" uppercase>
                        Recommended
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    variant="optionValue"
                    tone={supported ? 'primary' : 'faint'}
                  >
                    {option.value}
                  </Text>
                  <Text
                    variant="bodySmall"
                    tone={supported ? 'secondary' : 'danger'}
                  >
                    {optionSupport?.reason ?? 'Checking device support…'}
                  </Text>
                </View>

                {active ? (
                  <Icon source={CheckCircle} size={20} color={palette.brand} />
                ) : (
                  <View style={styles.radioEmpty} />
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <OnboardingNavBar
        onBack={() => router.back()}
        onAdvance={() => void finish()}
        advanceLabel="Finish"
        advanceIcon="check"
        advanceDisabled={
          isPending ||
          !support.find((option) => option.profile === choice)?.supported
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
  },
  heading: { textAlign: 'center', marginBottom: spacing.lg },
  description: { textAlign: 'center', marginBottom: spacing.xxl },
  deviceCard: {
    gap: spacing.sm,
    padding: spacing.lg,
    marginBottom: spacing.xxl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    backgroundColor: palette.surface,
  },
  deviceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  options: { gap: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: 13,
    paddingHorizontal: 25,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.canvas,
  },
  rowActive: { borderColor: palette.brand, backgroundColor: palette.surface },
  rowDisabled: { opacity: 0.55 },
  rowText: { flex: 1, gap: spacing.xs },
  optionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  radioEmpty: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: palette.border,
  },
  pressed: { opacity: 0.85 },
});
