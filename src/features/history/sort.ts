import type { HistoryEntry } from '@/storage/history';

/**
 * Chronological order is the primary axis in History — the screen is a log,
 * and "when" is the question people actually bring to it. Category is a
 * secondary, optional narrowing on top.
 */
export type SortOrder = 'newest' | 'oldest';

export const SORT_LABEL: Record<SortOrder, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
};

export function nextOrder(order: SortOrder): SortOrder {
  return order === 'newest' ? 'oldest' : 'newest';
}

export interface HistoryViewOptions {
  order: SortOrder;
  /** Scenario id, or `null` for every category. */
  category: string | null;
  query: string;
}

/**
 * Single place where filtering and sorting are applied, so the screen cannot
 * drift out of sync with the "N of M" count it reports.
 */
export function applyHistoryView(
  entries: HistoryEntry[],
  { order, category, query }: HistoryViewOptions,
): HistoryEntry[] {
  const needle = query.trim().toLowerCase();

  const filtered = entries.filter((entry) => {
    if (category && entry.threadId !== category) return false;
    if (!needle) return true;
    return (
      entry.prompt.toLowerCase().includes(needle) ||
      entry.reply.toLowerCase().includes(needle)
    );
  });

  // Copy before sorting: `entries` comes from the Query cache and must not be
  // mutated in place, or the cached array reorders under other subscribers.
  return [...filtered].sort((a, b) =>
    order === 'newest'
      ? b.createdAt - a.createdAt
      : a.createdAt - b.createdAt,
  );
}
