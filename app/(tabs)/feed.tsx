import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen } from '@/components/Screen';
import { TabSelector, type TabOption } from '@/components/TabSelector';
import { Text } from '@/components/Text';
import { TopAppBar } from '@/components/TopAppBar';
import { ScenarioCard } from '@/features/scenarios/ScenarioCard';
import { SCENARIOS, type Scenario } from '@/features/scenarios/registry';
import { gutter, spacing } from '@/theme/tokens';

const ALL = 'all';

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

  const visible = useMemo(
    () => (filter === ALL ? SCENARIOS : SCENARIOS.filter((s) => s.id === filter)),
    [filter],
  );

  const openChat = useCallback(
    (scenario: Scenario) => router.push(`/chat?scenario=${scenario.id}`),
    [router],
  );

  // Selecting a tab other than "All" is itself a request to work in that
  // scenario, so it opens the chat — per the brief, a scenario tab is an
  // entry point, not just a filter.
  const onTabChange = useCallback(
    (id: string) => {
      setFilter(id);
      if (id !== ALL) router.push(`/chat?scenario=${id}`);
    },
    [router],
  );

  return (
    <Screen>
      <TopAppBar />

      <FlatList
        data={visible}
        keyExtractor={(scenario) => scenario.id}
        renderItem={({ item }) => (
          <ScenarioCard scenario={item} onPress={openChat} />
        )}
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
  separator: { height: spacing.lg },
  empty: { textAlign: 'center', paddingVertical: spacing.xxl },
});
