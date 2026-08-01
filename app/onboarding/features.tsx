import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { collectDeviceAssessment } from "@/attestation/client/deviceAssessment";
import { Icon } from "@/components/Icon";
import { OnboardingNavBar } from "@/components/OnboardingNavBar";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { chunkRows } from "@/features/scenarios/chunkRows";
import { SCENARIOS, type ScenarioId } from "@/features/scenarios/registry";
import { setDeviceAssessment, setSelectedCategories } from "@/storage/prefs";
import { gutter, palette, radius, spacing } from "@/theme/tokens";

const COLUMN_GAP = spacing.lg;
const COLUMNS = 2;

export default function OnboardingFeatures() {
  const router = useRouter();
  const [selected, setSelected] = useState<ScenarioId[]>([]);
  const [checkingDevice, setCheckingDevice] = useState(false);
  const rows = useMemo(() => chunkRows(SCENARIOS, COLUMNS), []);

  const toggle = useCallback((id: ScenarioId) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((existing) => existing !== id)
        : [...current, id],
    );
  }, []);

  const advance = useCallback(async () => {
    if (checkingDevice) return;
    setCheckingDevice(true);

    await setSelectedCategories(selected);
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
      setCheckingDevice(false);
      router.push("/onboarding/connections");
    }
  }, [checkingDevice, router, selected]);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text variant="display" style={styles.heading}>
            What would you like help with?
          </Text>
          <Text variant="bodyLarge" tone="secondary" style={styles.body}>
            Choose the features you plan to use. You can change this later.
          </Text>
        </View>

        <View style={styles.grid}>
          {rows.map((row, rowIndex) => (
            <View key={`row-${rowIndex}`} style={styles.row}>
              {row.map((scenario, columnIndex) => {
                if (!scenario) {
                  return (
                    <View
                      key={`spacer-${rowIndex}-${columnIndex}`}
                      style={styles.cellSlot}
                    />
                  );
                }

                const active = selected.includes(scenario.id);
                return (
                  <Pressable
                    key={scenario.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={scenario.title}
                    disabled={checkingDevice}
                    onPress={() => toggle(scenario.id)}
                    style={({ pressed }) => [
                      styles.cellSlot,
                      styles.cell,
                      active && styles.cellActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Icon
                      source={scenario.Icon}
                      size={30}
                      color={active ? palette.brand : palette.textSecondary}
                    />
                    <Text
                      variant="label"
                      tone={active ? "brand" : "primary"}
                      style={styles.cellLabel}
                    >
                      {scenario.title}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {checkingDevice ? (
          <View style={styles.assessmentCard} accessibilityLiveRegion="polite">
            <ActivityIndicator color={palette.brand} />
            <View style={styles.assessmentCopy}>
              <Text variant="label">Checking this device</Text>
              <Text variant="body" tone="secondary">
                Preparing compatible models for the final step.
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <OnboardingNavBar
        onBack={() => router.back()}
        onAdvance={() => void advance()}
        advanceLabel={checkingDevice ? "Checking" : "Continue"}
        advanceDisabled={checkingDevice}
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
  intro: { alignItems: "center", paddingBottom: spacing.xxxl },
  heading: { textAlign: "center", marginBottom: spacing.lg },
  body: { textAlign: "center" },
  grid: { gap: COLUMN_GAP },
  row: { flexDirection: "row", gap: COLUMN_GAP },
  cellSlot: { flex: 1, minWidth: 0 },
  cell: {
    minHeight: 144,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
  },
  cellActive: {
    borderColor: palette.brand,
    backgroundColor: palette.brandWash,
  },
  cellLabel: { textAlign: "center" },
  pressed: { opacity: 0.8 },
  assessmentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginTop: spacing.xxl,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    backgroundColor: palette.surface,
  },
  assessmentCopy: { flex: 1, gap: spacing.xs },
});
