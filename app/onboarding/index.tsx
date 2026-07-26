import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { OnboardingNavBar } from '@/components/OnboardingNavBar';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import CreepyMascot from '@assets/icons/creepy-mascot.svg';
import { chunkRows } from '@/features/scenarios/chunkRows';
import { SCENARIOS, type ScenarioId } from '@/features/scenarios/registry';
import { setSelectedCategories } from '@/storage/prefs';
import { gutter, palette, radius, shadow, spacing } from '@/theme/tokens';

/** Figma: 2 columns, 16pt gutter, inside a 24pt page margin on a 390pt frame. */
const COLUMN_GAP = spacing.lg;
const COLUMNS = 2;

export default function OnboardingCategories() {
  const router = useRouter();
  const [selected, setSelected] = useState<ScenarioId[]>([]);

  // Explicit rows, not flexWrap — see chunkRows for why the column count must
  // not depend on measured width.
  const rows = useMemo(() => chunkRows(SCENARIOS, COLUMNS), []);

  const toggle = useCallback((id: ScenarioId) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((existing) => existing !== id)
        : [...current, id],
    );
  }, []);

  const advance = useCallback(async () => {
    await setSelectedCategories(selected);
    router.push('/onboarding/memory');
  }, [router, selected]);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <View style={styles.mascotFrame}>
            <CreepyMascot width={64} height={64} color={palette.brand} />
          </View>

          <Text variant="headline" style={styles.heading}>
            Where do you need support most?
          </Text>
          <Text variant="bodyLarge" tone="secondary" style={styles.body}>
            Select the categories you&apos;ll use most frequently to help Creepy
            optimize your experience.
          </Text>
        </View>

        <View style={styles.grid}>
          {rows.map((row, rowIndex) => (
            <View key={`row-${rowIndex}`} style={styles.row}>
              {row.map((scenario, columnIndex) => {
                // Padding slot for a short final row: holds the column open so
                // a lone cell keeps its width instead of stretching.
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
                      tone={active ? 'brand' : 'primary'}
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
      </ScrollView>

      <OnboardingNavBar
        onAdvance={() => void advance()}
        advanceLabel="Continue"
        // Skipping is allowed: an empty selection is a valid answer, and
        // blocking here would trap anyone who genuinely wants everything.
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  intro: { alignItems: 'center', paddingBottom: spacing.xxxl },
  // Figma bakes the rounded frame into the mascot bitmap; the vector has no
  // chrome, so the frame is drawn here and the glyph inset within it.
  mascotFrame: {
    width: 96,
    height: 96,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.borderFaint,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: spacing.xxl,
    ...shadow.card,
  },
  heading: { textAlign: 'center', marginBottom: spacing.lg },
  body: { textAlign: 'center' },
  // Stack of explicit rows. No flexWrap anywhere in this grid.
  grid: { gap: COLUMN_GAP },
  row: { flexDirection: 'row', gap: COLUMN_GAP },
  /**
   * The column itself. `flex: 1` splits whatever width the row has into equal
   * shares after the gap is subtracted — no percentage, no measurement, no way
   * to overflow. `minWidth: 0` stops a long label from forcing the cell wider
   * than its share, which is the one way flex children can still blow out a row.
   */
  cellSlot: { flex: 1, minWidth: 0 },
  cell: {
    minHeight: 144,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
  },
  cellActive: { borderColor: palette.brand, backgroundColor: palette.brandWash },
  cellLabel: { textAlign: 'center' },
  pressed: { opacity: 0.8 },
});
