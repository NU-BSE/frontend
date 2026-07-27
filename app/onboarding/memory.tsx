import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

const OPTIONS: {
  id: MemoryProfile;
  label: string;
  value: string;
}[] = [
  { id: 'efficient', label: 'Efficient', value: '512MB (Basic Support)' },
  { id: 'balanced', label: 'Balanced', value: '1B (Standard Tasks)' },
  { id: 'performance', label: 'Performance', value: '1.5B (Deep Analysis)' },
  { id: 'cloud', label: 'Cloud only', value: 'Opt-out' },
];

const formatBytes = (bytes?: number): string => {
  if (typeof bytes !== 'number') return 'Unknown';
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
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

  const support = useMemo(
    () => getModelOptionSupport(assessment ?? null),
    [assessment],
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
    await setOnboardingComplete();
    void activateSelectedEngine(choice, assessment ?? null);
    await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
    router.replace('/(tabs)/feed');
  }, [activateSelectedEngine, assessment, choice, queryClient, router, support]);

  const summary =
    assessment?.platform === 'android'
      ? `${assessment.hardware.model ?? 'Android device'} · ${formatBytes(
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
