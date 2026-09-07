import React, { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { track } from '@/analytics';
import { submitOnboardingFeedback } from '@/api/client';
import { Icon } from '@/components/Icon';
import { OnboardingNavBar } from '@/components/OnboardingNavBar';
import { OnboardingProgress, progressFor } from '@/components/OnboardingProgress';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import {
  ALTERNATIVE_OPTIONS,
  buildFeedbackPayload,
  expectsExplanation,
  FEEDBACK_RESULT_OPTIONS,
  isOtherAlternative,
  type AlternativeId,
  type FeedbackResult,
} from '@/features/onboarding/feedback';
import { setFeedbackDone } from '@/storage/prefs';
import { gutter, palette, radius, spacing } from '@/theme/tokens';
import CheckCircle from '@assets/icons/check-circle-filled.svg';

/**
 * Post-first-task custdev.
 *
 * Shown only after the first real agent run completes. Success is ultimately
 * defined by what the user says here, not by the fact that a message was sent.
 */
export default function OnboardingFeedback() {
  const router = useRouter();
  const [result, setResult] = useState<FeedbackResult | null>(null);
  const [expectation, setExpectation] = useState('');
  const [alternative, setAlternative] = useState<AlternativeId | null>(null);
  const [alternativeNote, setAlternativeNote] = useState('');
  const [saving, setSaving] = useState(false);

  const showExpectation = result !== null && expectsExplanation(result);
  const showAlternativeNote = isOtherAlternative(alternative);

  const submit = useCallback(async () => {
    if (!result || saving) return;
    setSaving(true);

    const payload = buildFeedbackPayload({
      result,
      expectation,
      alternative,
      alternativeNote,
    });

    await setFeedbackDone();
    track('onboarding_feedback_submitted', {
      feedback_result: result,
      alternative: alternative ?? undefined,
    });

    void submitOnboardingFeedback(payload).catch(() => undefined);

    setSaving(false);
    router.replace('/onboarding/subscription');
  }, [alternative, alternativeNote, expectation, result, router, saving]);

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.progressWrap}>
          <OnboardingProgress fraction={progressFor('feedback')} />
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <Text variant="display" style={styles.heading}>
              Did Creepy do what you expected?
            </Text>
          </View>

          <View style={styles.resultRow}>
            {FEEDBACK_RESULT_OPTIONS.map((option) => {
              const active = result === option.id;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  disabled={saving}
                  onPress={() => setResult(option.id)}
                  style={({ pressed }) => [
                    styles.resultOption,
                    active && styles.resultOptionActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    variant="label"
                    tone={active ? 'inverse' : 'primary'}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {showExpectation ? (
            <View style={styles.section}>
              <Text variant="headline">
                What did you expect Creepy to do instead?
              </Text>
              <TextInput
                accessibilityLabel="What did you expect Creepy to do instead?"
                autoCapitalize="sentences"
                autoCorrect
                multiline
                onChangeText={setExpectation}
                placeholder="Tell us in your own words (optional)"
                placeholderTextColor={palette.textFaint}
                style={styles.input}
                value={expectation}
              />
            </View>
          ) : null}

          <View style={styles.section}>
            <Text variant="headline">
              Without Creepy, what would you have done?
            </Text>
            <View style={styles.optionList}>
              {ALTERNATIVE_OPTIONS.map((option) => {
                const active = alternative === option.id;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    disabled={saving}
                    onPress={() => setAlternative(option.id)}
                    style={({ pressed }) => [
                      styles.option,
                      active && styles.optionActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      variant="body"
                      tone={active ? 'brand' : 'primary'}
                      style={styles.optionLabel}
                    >
                      {option.label}
                    </Text>
                    {active ? (
                      <Icon
                        source={CheckCircle}
                        size={18}
                        color={palette.brand}
                      />
                    ) : (
                      <View style={styles.radioEmpty} />
                    )}
                  </Pressable>
                );
              })}
            </View>

            {showAlternativeNote ? (
              <TextInput
                accessibilityLabel="Other alternative details"
                autoCapitalize="sentences"
                autoCorrect
                multiline
                onChangeText={setAlternativeNote}
                placeholder="What would you have done? (optional)"
                placeholderTextColor={palette.textFaint}
                style={styles.input}
                value={alternativeNote}
              />
            ) : null}
          </View>
        </ScrollView>

        <OnboardingNavBar
          onBack={() => router.back()}
          onAdvance={() => void submit()}
          advanceLabel={saving ? 'Saving' : 'Continue'}
          advanceDisabled={!result || saving}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  heading: { textAlign: 'center' },
  resultRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  resultOption: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  resultOptionActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  section: { gap: spacing.lg, paddingBottom: spacing.xxl },
  input: {
    minHeight: 96,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    color: palette.textPrimary,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  optionList: { gap: spacing.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  optionActive: { borderColor: palette.brand, backgroundColor: palette.brandWash },
  optionLabel: { flex: 1 },
  radioEmpty: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: palette.border,
  },
  pressed: { opacity: 0.75 },
});