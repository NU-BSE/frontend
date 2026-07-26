import React, { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { OnboardingNavBar } from '@/components/OnboardingNavBar';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import CheckCircle from '@assets/icons/check-circle-filled.svg';
import {
  setMemoryProfile,
  setOnboardingComplete,
  type MemoryProfile,
} from '@/storage/prefs';
import { gutter, palette, radius, spacing } from '@/theme/tokens';

/** Copy lifted verbatim from the Memory Config frame. */
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

export default function OnboardingMemory() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<MemoryProfile>('efficient');

  const finish = useCallback(async () => {
    await setMemoryProfile(choice);
    await setOnboardingComplete();
    // The entry gate reads this through Query; invalidating keeps the two in
    // sync rather than relying on a remount.
    await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
    router.replace('/(tabs)/feed');
  }, [choice, queryClient, router]);

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
          Choose how much memory to allocate for local LLM execution. Higher
          limits enable more complex reasoning.
        </Text>

        <View style={styles.options}>
          {OPTIONS.map((option) => {
            const active = option.id === choice;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${option.label}, ${option.value}`}
                onPress={() => setChoice(option.id)}
                style={({ pressed }) => [
                  styles.row,
                  active && styles.rowActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.rowText}>
                  <Text variant="overline" tone="secondary" uppercase>
                    {option.label}
                  </Text>
                  <Text variant="optionValue">{option.value}</Text>
                </View>

                {active ? (
                  <Icon source={CheckCircle} size={20} color={palette.brand} />
                ) : (
                  // The Figma export has no unselected-radio asset, and a
                  // bordered circle is exactly what the frame shows — drawing
                  // it avoids inventing an icon that does not exist.
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
  description: { textAlign: 'center', marginBottom: spacing.xxxl },
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
  rowText: { flex: 1, gap: spacing.xs },
  radioEmpty: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: palette.border,
  },
  pressed: { opacity: 0.85 },
});
