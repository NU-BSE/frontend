import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';

import { withInternalPromptToken } from '@/agent/promptIntent';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen } from '@/components/Screen';
import { TabSelector, type TabOption } from '@/components/TabSelector';
import { Text } from '@/components/Text';
import { TopAppBar } from '@/components/TopAppBar';
import { GuideCard } from '@/features/scenarios/GuideCard';
import { ScenarioCard } from '@/features/scenarios/ScenarioCard';
import { ANDROID_GUIDE_CLUSTERS } from '@/features/scenarios/androidGuides';
import { SCENARIOS, type Scenario } from '@/features/scenarios/registry';
import { gutter, spacing } from '@/theme/tokens';

const ALL = 'all';

/**
 * The Settings tab is a library, not a single card.
 *
 * Every guide from creepy.im's "Fix the Android problem you actually have"
 * is listed, under the site's own cluster headings. Flattening the six
 * clusters into thirty-six undifferentiated cards would make the list a wall;
 * the headings are what make it scannable.
 */
type FeedRow =
  | { kind: 'scenario'; key: string; scenario: Scenario }
  | { kind: 'heading'; key: string; title: string; subtitle: string }
  | { kind: 'guide'; key: string; prompt: string };

const SETTINGS_ROWS: FeedRow[] = ANDROID_GUIDE_CLUSTERS.flatMap((cluster) => [
  {
    kind: 'heading' as const,
    key: `heading-${cluster.n}`,
    title: cluster.name,
    subtitle: cluster.label,
  },
  ...cluster.prompts.map((prompt) => ({
    kind: 'guide' as const,
    key: prompt,
    prompt,
  })),
]);

export default function Feed() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState(ALL);

  const tabs = useMemo<TabOption[]>(
    () => [
      { id: ALL, label: 'All' },
      ...SCENARIOS.map((s) => ({ id: s.id, label: s.title })),
    ],
    [],
  );

  const visible = useMemo<FeedRow[]>(() => {
    if (filter === 'settings') return SETTINGS_ROWS;
    const scenarios =
      filter === ALL ? SCENARIOS : SCENARIOS.filter((s) => s.id === filter);
    return scenarios.map((scenario) => ({
      kind: 'scenario' as const,
      key: scenario.id,
      scenario,
    }));
  }, [filter]);

  const openChat = useCallback(
    (scenario: Scenario) => router.push(`/chat?scenario=${scenario.id}`),
    [router],
  );

  const openGuide = useCallback(
    (prompt: string) =>
      router.push(
        // Marked as in-app so the chat may send it without a further tap;
        // an external link carrying the same prompt cannot.
        withInternalPromptToken(
          `/chat?scenario=settings&prompt=${encodeURIComponent(prompt)}`,
        ),
      ),
    [router],
  );

  /*
   * Selecting a scenario tab is itself a request to work in that scenario, so
   * it opens the chat — a tab is an entry point, not just a filter.
   *
   * Settings is the exception: it now has a browsable library behind it, and
   * jumping straight to the chat would make those guides unreachable.
   */
  const onTabChange = useCallback(
    (id: string) => {
      setFilter(id);
      if (id !== ALL && id !== 'settings') router.push(`/chat?scenario=${id}`);
    },
    [router],
  );

  return (
    <Screen>
      <TopAppBar />

      <FlatList
        data={visible}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => {
          if (item.kind === 'scenario') {
            return <ScenarioCard scenario={item.scenario} onPress={openChat} />;
          }
          if (item.kind === 'guide') {
            return <GuideCard prompt={item.prompt} onPress={openGuide} />;
          }
          return (
            <View style={styles.heading}>
              <Text variant="headline">{item.title}</Text>
              <Text variant="bodySmall" tone="secondary">
                {item.subtitle}
              </Text>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.tabs}>
            <TabSelector options={tabs} value={filter} onChange={onTabChange} />
          </View>
        }
        ListEmptyComponent={
          <Text variant="body" tone="muted" style={styles.empty}>
            Nothing in this category yet.
          </Text>
        }
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xxxl },
        ]}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: gutter.home, paddingTop: spacing.lg },
  tabs: { marginBottom: spacing.sm, marginHorizontal: -gutter.home, paddingLeft: gutter.home },
  separator: { height: spacing.md },
  // Headings need more air above than the cards they group.
  heading: { gap: spacing.xs, paddingTop: spacing.lg },
  empty: { textAlign: 'center', paddingVertical: spacing.xxl },
});
