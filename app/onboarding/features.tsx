import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { track } from "@/analytics";
import { collectDeviceAssessment } from "@/attestation/client/deviceAssessment";
import { Icon } from "@/components/Icon";
import { OnboardingNavBar } from "@/components/OnboardingNavBar";
import { OnboardingProgress, progressFor } from "@/components/OnboardingProgress";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import {
  CUSTOM_INTENT_LABEL,
  CUSTOM_INTENT_PLACEHOLDER,
  intentsToScenarioIds,
  ONBOARDING_INTENTS,
  type OnboardingIntent,
} from "@/features/onboarding/intents";
import { submitOnboardingIntents } from "@/api/client";
import {
  setCustomIntent,
  setDeviceAssessment,
  setIntentCompleted,
  setSelectedCategories,
  setSelectedIntents,
  type OnboardingIntentId,
} from "@/storage/prefs";
import { gutter, palette, radius, shadow, spacing } from "@/theme/tokens";
import CatCalendar from "@assets/icons/cat-calendar.svg";
import CatDrive from "@assets/icons/cat-drive.svg";
import CatEmail from "@assets/icons/cat-email.svg";
import CatMessaging from "@assets/icons/cat-messaging.svg";
import CatSettings from "@assets/icons/cat-settings.svg";
import CheckCircle from "@assets/icons/check-circle-filled.svg";
import type { SvgProps } from "react-native-svg";

const COLUMN_GAP = spacing.lg;
const COLUMNS = 2;

const INTENT_ICON: Record<OnboardingIntentId, React.FC<SvgProps>> = {
  android_settings: CatSettings,
  messages: CatMessaging,
  email: CatEmail,
  calendar: CatCalendar,
  drive: CatDrive,
};

const rows = (intents: OnboardingIntent[]): (OnboardingIntent | undefined)[][] => {
  const out: (OnboardingIntent | undefined)[][] = [];
  for (let i = 0; i < intents.length; i += COLUMNS) {
    const row: (OnboardingIntent | undefined)[] = intents.slice(i, i + COLUMNS);
    while (row.length < COLUMNS) row.push(undefined);
    out.push(row);
  }
  return out;
};

/**
 * The intent screen ("What should Creepy help you with first?").
 *
 * Multi-select interests, including Android & Settings. Note the distinction:
 * an interest is what the user *wants help with* — Android & Settings is a
 * valid interest even though the Settings connector is always available.
 * Integration availability is a separate concern handled on the Connections
 * screen.
 */
export default function OnboardingFeatures() {
  const router = useRouter();
  const [selected, setSelected] = useState<OnboardingIntentId[]>([]);
  const [customActive, setCustomActive] = useState(false);
  const [customText, setCustomText] = useState("");
  const [saving, setSaving] = useState(false);
  const grid = useMemo(() => rows(ONBOARDING_INTENTS), []);

  const toggle = useCallback((id: OnboardingIntentId) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((existing) => existing !== id)
        : [...current, id],
    );
  }, []);

  const advance = useCallback(async () => {
    if (saving) return;
    setSaving(true);

    await Promise.all([
      setSelectedIntents(selected),
      setSelectedCategories(intentsToScenarioIds(selected)),
      setCustomIntent(customActive && customText.trim() ? customText.trim() : null),
      setIntentCompleted(),
    ]);

    track("onboarding_intent_selected", {
      selected_intents: selected,
    });

    // The backend answer is best-effort and must never block the flow.
    void submitOnboardingIntents({
      intent_ids: selected,
      ...(customActive && customText.trim()
        ? { custom_intent: customText.trim() }
        : {}),
    }).catch(() => undefined);

    try {
      const assessment = await collectDeviceAssessment();
      await setDeviceAssessment(assessment);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Device assessment failed.";
      await setDeviceAssessment({
        schemaVersion: 1,
        platform: "unsupported",
        collectedAtMs: Date.now(),
        reason,
      });
    } finally {
      setSaving(false);
      router.push("/onboarding/connections");
    }
  }, [customActive, customText, router, saving, selected]);

  return (
    <Screen>
      <View style={styles.progressWrap}>
        <OnboardingProgress fraction={progressFor("intent")} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text variant="display" style={styles.heading}>
            What should Creepy help you with first?
          </Text>
          <Text variant="bodyLarge" tone="secondary" style={styles.body}>
            Pick anything that sounds useful. This only personalizes your
            starting experience.
          </Text>
        </View>

        <View style={styles.grid}>
          {grid.map((row, rowIndex) => (
            <View key={`row-${rowIndex}`} style={styles.row}>
              {row.map((intent, columnIndex) => {
                if (!intent) {
                  return (
                    <View
                      key={`spacer-${rowIndex}-${columnIndex}`}
                      style={styles.cellSlot}
                    />
                  );
                }
                const active = selected.includes(intent.id);
                const IntentIcon = INTENT_ICON[intent.id];
                return (
                  <Pressable
                    key={intent.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`${intent.title}. ${intent.description}`}
                    disabled={saving}
                    onPress={() => toggle(intent.id)}
                    style={({ pressed }) => [
                      styles.cellSlot,
                      styles.cell,
                      active && styles.cellActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    {active ? (
                      <View style={styles.check}>
                        <Icon
                          source={CheckCircle}
                          size={18}
                          color={palette.brand}
                        />
                      </View>
                    ) : null}
                    <Icon
                      source={IntentIcon}
                      size={30}
                      color={active ? palette.brand : palette.textSecondary}
                    />
                    <Text
                      variant="label"
                      tone={active ? "brand" : "primary"}
                      style={styles.cellLabel}
                    >
                      {intent.title}
                    </Text>
                    <Text
                      variant="bodySmall"
                      tone="secondary"
                      style={styles.cellLabel}
                    >
                      {intent.description}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: customActive }}
          disabled={saving}
          onPress={() => setCustomActive((active) => !active)}
          style={({ pressed }) => [
            styles.custom,
            customActive && styles.customActive,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.customLabel}>
            <Icon
              source={CheckCircle}
              size={18}
              color={customActive ? palette.brand : palette.border}
            />
            <Text variant="label" tone={customActive ? "brand" : "primary"}>
              {CUSTOM_INTENT_LABEL}
            </Text>
          </View>
        </Pressable>

        {customActive ? (
          <TextInput
            accessibilityLabel="Custom request"
            autoCapitalize="sentences"
            autoCorrect
            multiline
            onChangeText={setCustomText}
            placeholder={CUSTOM_INTENT_PLACEHOLDER}
            placeholderTextColor={palette.textFaint}
            style={styles.customInput}
            value={customText}
          />
        ) : null}

        {saving ? (
          <View style={styles.savingCard} accessibilityLiveRegion="polite">
            <ActivityIndicator color={palette.brand} />
            <View style={styles.savingCopy}>
              <Text variant="label">Preparing your Creepy</Text>
              <Text variant="body" tone="secondary">
                Checking what this phone can run.
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <OnboardingNavBar
        onBack={() => router.back()}
        onAdvance={() => void advance()}
        advanceLabel={saving ? "Saving" : "Continue"}
        advanceDisabled={saving}
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
  intro: { alignItems: "center", paddingBottom: spacing.xxl },
  heading: { textAlign: "center", marginBottom: spacing.lg },
  body: { textAlign: "center" },
  grid: { gap: COLUMN_GAP },
  row: { flexDirection: "row", gap: COLUMN_GAP },
  cellSlot: { flex: 1, minWidth: 0 },
  cell: {
    position: "relative",
    minHeight: 152,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
    ...shadow.card,
  },
  cellActive: {
    borderColor: palette.brand,
    backgroundColor: palette.brandWash,
  },
  check: { position: "absolute", top: spacing.sm, right: spacing.sm },
  cellLabel: { textAlign: "center" },
  pressed: { opacity: 0.8 },
  custom: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
    borderStyle: "dashed",
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  customActive: { borderColor: palette.brand, borderStyle: "solid" },
  customLabel: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  customInput: {
    minHeight: 96,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    color: palette.textPrimary,
    fontSize: 16,
    textAlignVertical: "top",
  },
  savingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    backgroundColor: palette.surface,
  },
  savingCopy: { flex: 1, gap: spacing.xs },
});