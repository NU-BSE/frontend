import React, { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { TabSelector, type TabOption } from '@/components/TabSelector';
import { Text } from '@/components/Text';
import { TopAppBar } from '@/components/TopAppBar';
import ChevronRight from '@assets/icons/chevron-right.svg';
import SearchIcon from '@assets/icons/filter.svg';
import {
  ACCENT_STYLE,
  SCENARIOS,
  getScenario,
} from '@/features/scenarios/registry';
import {
  SORT_LABEL,
  applyHistoryView,
  nextOrder,
  type SortOrder,
} from '@/features/history/sort';
import { clearHistory, listHistory, type HistoryEntry } from '@/storage/history';
import {
  MIN_TOUCH_TARGET,
  gutter,
  palette,
  radius,
  shadow,
  spacing,
  typography,
} from '@/theme/tokens';

const ALL = 'all';

/** Figma shows "12 OCT 2023 • 14:45". */
function formatStamp(epochMs: number): string {
  const d = new Date(epochMs);
  const day = String(d.getDate()).padStart(2, '0');
  const month = d
    .toLocaleString('en-GB', { month: 'short' })
    .toUpperCase();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
  return `${day} ${month} ${d.getFullYear()} • ${time}`;
}

function HistoryRow({
  entry,
  onPress,
}: {
  entry: HistoryEntry;
  onPress: (entry: HistoryEntry) => void;
}) {
  const accent =
    ACCENT_STYLE[getScenario(entry.threadId)?.accent ?? 'neutral'];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.category} inquiry from ${formatStamp(entry.createdAt)}`}
      onPress={() => onPress(entry)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowHeader}>
        <View style={[styles.tag, { backgroundColor: accent.wash }]}>
          <Text variant="overline" uppercase style={{ color: accent.ink }}>
            {entry.category}
          </Text>
        </View>
        <Text variant="overline" tone="faint" uppercase>
          {formatStamp(entry.createdAt)}
        </Text>
      </View>

      <Text variant="quote" numberOfLines={4} style={styles.quote}>
        “{entry.prompt || entry.reply}”
      </Text>

      <View style={styles.chevron}>
        <Icon source={ChevronRight} size={7} height={12} color={palette.textSecondary} />
      </View>
    </Pressable>
  );
}

export default function History() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(ALL);
  const [order, setOrder] = useState<SortOrder>('newest');

  const { data, isPending, isRefetching, refetch } = useQuery({
    queryKey: ['history'],
    queryFn: listHistory,
  });

  const wipe = useMutation({
    mutationFn: clearHistory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['history'] }),
  });

  const tabs = useMemo<TabOption[]>(
    () => [
      { id: ALL, label: 'All' },
      ...SCENARIOS.map((s) => ({ id: s.id, label: s.title })),
    ],
    [],
  );

  const entries = useMemo(
    () =>
      applyHistoryView(data ?? [], {
        order,
        category: filter === ALL ? null : filter,
        query,
      }),
    [data, filter, order, query],
  );

  const total = data?.length ?? 0;
  const isNarrowed = filter !== ALL || query.trim().length > 0;

  const openEntry = useCallback(
    (entry: HistoryEntry) =>
      router.push(
        entry.threadId === 'general'
          ? '/chat'
          : `/chat?scenario=${entry.threadId}`,
      ),
    [router],
  );

  return (
    <Screen>
      <TopAppBar />

      {isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.brand} />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(entry) => entry.id}
          renderItem={({ item }) => (
            <HistoryRow entry={item} onPress={openEntry} />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + spacing.xxxl },
            entries.length === 0 && styles.contentEmpty,
          ]}
          ListHeaderComponent={
            <View style={styles.controls}>
              <View style={styles.search}>
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search past inquiries..."
                  placeholderTextColor={palette.textMuted}
                  returnKeyType="search"
                />

                {/* The Figma glyph here is a filter, not a magnifier — so it
                    drives the sort rather than sitting decorative. Moved to
                    the trailing edge because it is an action, not a label. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Sort: ${SORT_LABEL[order]}. Tap to switch.`}
                  onPress={() => setOrder(nextOrder(order))}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.sortButton,
                    order !== 'newest' && styles.sortButtonActive,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <Icon
                    source={SearchIcon}
                    size={18}
                    height={12}
                    color={
                      order === 'newest' ? palette.textSecondary : palette.brand
                    }
                  />
                </Pressable>
              </View>

              <View style={styles.tabs}>
                <TabSelector options={tabs} value={filter} onChange={setFilter} />
              </View>

              <View style={styles.summary}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Sort order: ${SORT_LABEL[order]}. Tap to switch.`}
                  onPress={() => setOrder(nextOrder(order))}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.sortLabel,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <Text variant="overline" tone="brand" uppercase>
                    {SORT_LABEL[order]}
                  </Text>
                  <Text variant="overline" tone="brand">
                    {order === 'newest' ? '↓' : '↑'}
                  </Text>
                </Pressable>

                <Text variant="overline" tone="faint" uppercase>
                  {isNarrowed
                    ? `${entries.length} of ${total}`
                    : `${total} record${total === 1 ? '' : 's'}`}
                </Text>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="bodyLarge" tone="muted" style={styles.emptyText}>
                {query || filter !== ALL
                  ? 'Nothing matches that.'
                  : 'Nothing has been said yet.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            entries.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => wipe.mutate()}
                disabled={wipe.isPending}
                style={({ pressed }) => [
                  styles.loadMore,
                  pressed && styles.rowPressed,
                ]}
              >
                <Text variant="overline" tone="brand" uppercase>
                  Clear all records
                </Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: gutter.screen, paddingTop: spacing.xl },
  contentEmpty: { flexGrow: 1 },
  controls: { gap: spacing.lg, paddingBottom: spacing.xl },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderFaint,
    borderRadius: radius.md,
    paddingHorizontal: 17,
    ...shadow.card,
  },
  searchInput: {
    flex: 1,
    color: palette.textPrimary,
    paddingVertical: spacing.md,
    ...typography.body,
  },
  sortButton: {
    padding: spacing.sm,
    borderRadius: radius.md,
  },
  sortButtonActive: { backgroundColor: palette.brandWash },
  tabs: { marginHorizontal: -gutter.screen, paddingLeft: gutter.screen },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sortLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  separator: { height: spacing.xl },
  row: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.xl,
    padding: 25,
    ...shadow.card,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  quote: { marginTop: spacing.sm },
  chevron: { marginTop: spacing.lg },
  rowPressed: { opacity: 0.85 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { textAlign: 'center' },
  loadMore: {
    alignSelf: 'center',
    marginTop: spacing.xxl,
    paddingBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: palette.brandHairline,
  },
});
