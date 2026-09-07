import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Icon } from '@/components/Icon';
import { OnboardingProgress, progressFor } from '@/components/OnboardingProgress';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useConnections } from '@/connections/useConnections';
import {
  buildFirstTaskChatUrl,
  buildFirstTaskSuggestions,
  type FirstTaskSuggestion,
} from '@/features/onboarding/suggestions';
import { getSelectedIntents } from '@/storage/prefs';
import { gutter, palette, radius, spacing } from '@/theme/tokens';
import ChevronRight from '@assets/icons/chevron-right.svg';

/**
 * The first real task.
 *
 * This is where Creepy earns the install: a concrete, working action picked
 * from what the user actually connected. Tapping a suggestion opens the real
 * chat and sends a real prompt — there is no fake demo run in between.
 */
export default function OnboardingTry() {
  const router = useRouter();
  const { data: connections } = useConnections();
  const [intents, setIntents] = useState<string[]>([]);
  const [customActive, setCustomActive] = useState(false);
  const [customText, setCustomText] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getSelectedIntents().then((ids) => {
      if (!cancelled) setIntents(ids);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    track('onboarding_first_task_viewed');
  }, []);

  const suggestions = useMemo(
    () =>
      buildFirstTaskSuggestions({
        intents: intents as Parameters<typeof buildFirstTaskSuggestions>[0]['intents'],
        connections: (connections ?? []).map((record) => ({
          connectorId: record.connectorId,
          status: record.status,
        })),
      }),
    [connections, intents],
  );

  const openSuggestion = useCallback(
    (suggestion: FirstTaskSuggestion) => {
      router.push(buildFirstTaskChatUrl(suggestion));
    },
    [router],
  );

  const openCustom = useCallback(() => {
    const prompt = customText.trim();
    if (!prompt) return;
    router.push(
      buildFirstTaskChatUrl({ id: 'custom', title: prompt, scenarioId: null }),
    );
  }, [customText, router]);

  const canSendCustom = customText.trim().length > 0;

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.progressWrap}>
          <OnboardingProgress fraction={progressFor('try')} />
        </View>
        <View style={styles.backRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            onPress={() => router.back()}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text variant="label" tone="secondary">
              Back
            </Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <Text variant="display" style={styles.heading}>
              Let&apos;s try Creepy
            </Text>
            <Text variant="bodyLarge" tone="secondary" style={styles.body}>
              Pick something you&apos;d actually like Creepy to do.
            </Text>
          </View>

          <View style={styles.list}>
            {suggestions.map((suggestion) => (
              <Pressable
                key={suggestion.id}
                accessibilityRole="button"
                accessibilityLabel={suggestion.title}
                onPress={() => openSuggestion(suggestion)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.pressed,
                ]}
              >
                <Text variant="body" style={styles.rowText}>
                  {suggestion.title}
                </Text>
                <Icon
                  source={ChevronRight}
                  size={7}
                  height={12}
                  color={palette.textSecondary}
                />
              </Pressable>
            ))}

            {suggestions.length === 0 ? (
              <Text variant="body" tone="secondary" style={styles.empty}>
                Nothing to suggest yet — ask Creepy anything below.
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: customActive }}
              onPress={() => setCustomActive((active) => !active)}
              style={({ pressed }) => [
                styles.row,
                customActive && styles.rowActive,
                pressed && styles.pressed,
              ]}
            >
              <Text
                variant="label"
                tone={customActive ? 'brand' : 'secondary'}
                style={styles.rowText}
              >
                Ask something else
              </Text>
              <Icon
                source={ChevronRight}
                size={7}
                height={12}
                color={palette.textSecondary}
              />
            </Pressable>

            {customActive ? (
              <View style={styles.customBox}>
                <TextInput
                  accessibilityLabel="Custom request"
                  autoCapitalize="sentences"
                  autoCorrect
                  multiline
                  onChangeText={setCustomText}
                  onSubmitEditing={() => {
                    if (canSendCustom) openCustom();
                  }}
                  placeholder="What would you like Creepy to do?"
                  placeholderTextColor={palette.textFaint}
                  style={styles.customInput}
                  value={customText}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canSendCustom }}
                  disabled={!canSendCustom}
                  onPress={openCustom}
                  style={({ pressed }) => [
                    styles.send,
                    !canSendCustom && styles.sendDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text variant="label" tone="inverse" uppercase>
                    Ask Creepy
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </ScrollView>
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
  backRow: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  content: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  intro: { alignItems: 'center', paddingBottom: spacing.xxl },
  heading: { textAlign: 'center', marginBottom: spacing.lg },
  body: { textAlign: 'center' },
  list: { gap: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  rowActive: { borderColor: palette.brand },
  rowText: { flex: 1 },
  empty: { textAlign: 'center', paddingVertical: spacing.md },
  customBox: { gap: spacing.lg },
  customInput: {
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
  send: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: palette.brand,
  },
  sendDisabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});