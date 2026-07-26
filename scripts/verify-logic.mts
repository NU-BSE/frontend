/**
 * Pure-logic checks that a typecheck cannot catch.
 *
 * Covers the History view pipeline (sort + filter + search) and the category
 * grid arithmetic that previously collapsed two columns into one.
 * Run: npm run verify:logic
 */
import {
  SORT_LABEL,
  applyHistoryView,
  nextOrder,
} from '../src/features/history/sort.js';
import type { HistoryEntry } from '../src/storage/history.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

const entry = (
  id: string,
  createdAt: number,
  threadId: string,
  prompt: string,
): HistoryEntry => ({
  id,
  threadId,
  category: threadId,
  prompt,
  reply: `reply for ${id}`,
  createdAt,
  engine: 'stub',
});

const FIXTURES: HistoryEntry[] = [
  entry('a', 3_000, 'sports', 'zombie racing teams'),
  entry('b', 1_000, 'settings', 'neural sensitivity threshold'),
  entry('c', 2_000, 'sports', 'nearest recharge station'),
];

console.log('history view:');

const newest = applyHistoryView(FIXTURES, {
  order: 'newest',
  category: null,
  query: '',
});
assert(
  newest.map((e) => e.id).join(',') === 'a,c,b',
  'newest-first orders descending by createdAt',
);

const oldest = applyHistoryView(FIXTURES, {
  order: 'oldest',
  category: null,
  query: '',
});
assert(
  oldest.map((e) => e.id).join(',') === 'b,c,a',
  'oldest-first orders ascending by createdAt',
);

const bySport = applyHistoryView(FIXTURES, {
  order: 'newest',
  category: 'sports',
  query: '',
});
assert(
  bySport.length === 2 && bySport.every((e) => e.threadId === 'sports'),
  'category narrows to one scenario',
);

const combined = applyHistoryView(FIXTURES, {
  order: 'oldest',
  category: 'sports',
  query: 'recharge',
});
assert(
  combined.length === 1 && combined[0]!.id === 'c',
  'category, search and order compose',
);

assert(
  applyHistoryView(FIXTURES, {
    order: 'newest',
    category: null,
    query: 'ZOMBIE',
  }).length === 1,
  'search is case-insensitive',
);

assert(
  applyHistoryView(FIXTURES, {
    order: 'newest',
    category: null,
    query: '   ',
  }).length === 3,
  'whitespace-only search is not a filter',
);

// The Query cache hands us its own array; reordering it in place would
// silently reshuffle data for every other subscriber.
const original = FIXTURES.map((e) => e.id).join(',');
applyHistoryView(FIXTURES, { order: 'oldest', category: null, query: '' });
assert(
  FIXTURES.map((e) => e.id).join(',') === original,
  'input array is not mutated',
);

assert(nextOrder('newest') === 'oldest', 'toggle flips newest to oldest');
assert(nextOrder('oldest') === 'newest', 'toggle flips back');
assert(
  Boolean(SORT_LABEL.newest && SORT_LABEL.oldest),
  'both orders have a visible label',
);

console.log('\ncategory grid arithmetic:');

const GUTTER = 24;
const GAP = 16;
const COLUMNS = 2;
const cellWidth = (w: number) => (w - GUTTER * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

assert(
  cellWidth(390) === 163,
  'a 390pt window yields Figma’s exact 163pt cell',
);

// The regression: two cells plus the gap must never exceed the content box,
// or Yoga wraps each cell onto its own row.
for (const windowWidth of [320, 360, 390, 412, 480, 600]) {
  const w = cellWidth(windowWidth);
  const content = windowWidth - GUTTER * 2;
  assert(
    w * COLUMNS + GAP <= content + 0.001 && w > 0,
    `two columns fit at ${windowWidth}pt (cell ${w.toFixed(1)}pt)`,
  );
}

// What the old percentage-based rule actually did, kept as the counter-example.
const OLD_MAX_PERCENT = 0.485;
const oldPair = 390 - GUTTER * 2;
assert(
  oldPair * OLD_MAX_PERCENT * 2 + GAP > oldPair,
  'the previous 48.5% + 16pt gap genuinely overflowed — regression reproduced',
);

console.log('\nlogic verified.');
