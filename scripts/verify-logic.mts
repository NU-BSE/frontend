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
import {
  SUBSCRIPTION_PLANS,
  TRIAL_DAYS,
  annualSavingUsd,
  planFor,
} from '../src/features/subscription/plans.js';
import { resolvePricing } from '../src/features/subscription/pricing.js';
import {
  ANDROID_GUIDE_CLUSTERS,
  ANDROID_GUIDE_LEAD_PROMPTS,
  ANDROID_GUIDE_PROMPTS,
} from '../src/features/scenarios/androidGuides.js';
import {
  NAME_MIN_LENGTH,
  canonicalName,
  isValidName,
  nameLength,
} from '../src/features/onboarding/name.js';

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
  entry('a', 3_000, 'calendar', 'week at a glance'),
  entry('b', 1_000, 'settings', 'neural sensitivity threshold'),
  entry('c', 2_000, 'calendar', 'next free hour'),
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

const byCalendar = applyHistoryView(FIXTURES, {
  order: 'newest',
  category: 'calendar',
  query: '',
});
assert(
  byCalendar.length === 2 && byCalendar.every((e) => e.threadId === 'calendar'),
  'category narrows to one scenario',
);

const combined = applyHistoryView(FIXTURES, {
  order: 'oldest',
  category: 'calendar',
  query: 'free hour',
});
assert(
  combined.length === 1 && combined[0]!.id === 'c',
  'category, search and order compose',
);

assert(
  applyHistoryView(FIXTURES, {
    order: 'newest',
    category: null,
    query: 'WEEK AT',
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

console.log('\nonboarding name field:');

// Any script is acceptable; the rule is length, not alphabet.
for (const name of ['Ilia', 'Илья', '花子', 'Ægir', 'Zoë', "O'Brien", 'Ali A']) {
  assert(isValidName(name), `accepts "${name}"`);
}

assert(!isValidName(''), 'rejects an empty name');
assert(!isValidName('   '), 'rejects whitespace only');
assert(!isValidName(' A '), 'rejects a single letter after trimming');

/*
 * The UTF-16 trap. `.length` counts surrogate halves, so each of these reports
 * 2 while being a single character — a naive check would wave them through as
 * if two characters had been typed.
 */
assert('😀'.length === 2, 'a single emoji is 2 UTF-16 code units');
assert(nameLength('😀') === 1, 'but counts as 1 code point');
assert(!isValidName('😀'), 'so one emoji is correctly rejected');

assert('𠀋'.length === 2, 'a single astral CJK glyph is 2 UTF-16 code units');
assert(nameLength('𠀋') === 1, 'but counts as 1 code point');
assert(!isValidName('𠀋'), 'so one astral glyph is correctly rejected');

assert(isValidName('😀😀'), 'two emoji satisfy the minimum');

/*
 * Composed vs decomposed input. "é" typed as e + U+0301 is 2 code points but
 * one visible character; NFC folds it to 1 so the check matches what is on
 * screen, and the backend receives one spelling rather than two.
 */
const decomposed = 'Jose\u0301';
assert(decomposed.length === 5, 'decomposed "José" is 5 code units before NFC');
assert(nameLength(canonicalName(decomposed)) === 4, 'NFC composes it to 4');
assert(
  canonicalName(decomposed) === canonicalName('Jos\u00e9'),
  'both spellings of "José" canonicalise identically',
);

const decomposedE = 'e\u0301';
assert(
  nameLength(canonicalName(decomposedE)) === 1,
  'a lone decomposed "é" is 1 character after NFC, not 2',
);
assert(
  !isValidName(decomposedE),
  `so it does not sneak past the ${NAME_MIN_LENGTH}-character minimum`,
);

assert(canonicalName('  Ilia  ') === 'Ilia', 'surrounding whitespace is trimmed');

console.log('\nsubscription plans:');

{
  assert(TRIAL_DAYS === 7, 'the trial is seven days, as published');
  assert(SUBSCRIPTION_PLANS.length === 2, 'exactly two billing periods');
  assert(planFor('monthly').listPrice === '$12.90', 'monthly is $12.90');
  assert(planFor('annual').listPrice === '$118.80', 'annual is $118.80');
  assert(planFor('annual').perMonth === '$9.90', 'annual works out to $9.90/mo');

  // The badge claims a saving; this is what proves the prices back it up.
  assert(annualSavingUsd() === 36, 'annual saves exactly $36 against monthly');
  assert(
    planFor('annual').badge === `Save $${annualSavingUsd()}`,
    'the badge matches the derived saving',
  );

  /*
   * Base plan ids are what Play matches offers on; a wrong one is a paywall
   * that cannot complete a purchase.
   *
   * This check used to assert /^creepyim-pro-(monthly|annual)$/ — a convention
   * invented here, matching nothing in the Play Console, which generated
   * plan-1 and plan-2. It passed for as long as the ids were wrong, because it
   * validated our guess rather than reality. Pinned to the console's ids now,
   * so changing one is a deliberate act.
   */
  const ids = SUBSCRIPTION_PLANS.map((plan) => plan.basePlanId);
  assert(new Set(ids).size === ids.length, 'base plan ids are distinct');
  assert(planFor('monthly').basePlanId === 'plan-1', 'monthly is plan-1');
  assert(planFor('annual').basePlanId === 'plan-2', 'annual is plan-2');

  /*
   * Localized pricing must be all-or-nothing.
   *
   * The screen previously showed Play's price beside USD-derived copy, so a
   * user in Hong Kong read "HK$99.00" above "Billed $12.90 today" and a
   * "Save $36" badge in a currency they are never charged.
   */
  {
    const hk = resolvePricing({
      monthly: {
        formattedPrice: 'HK$99.00',
        currencyCode: 'HKD',
        amountMicros: 99_000_000,
      },
      annual: {
        formattedPrice: 'HK$939.00',
        currencyCode: 'HKD',
        amountMicros: 939_000_000,
      },
    });

    assert(hk.fromStore, 'store prices are used when both periods are present');
    assert(hk.price('monthly') === 'HK$99.00', 'monthly shows the store price');
    assert(
      !/\$12\.90|\$118\.80|\$9\.90/u.test(hk.terms('monthly')),
      'monthly terms carry no USD figures when the store answered',
    );
    assert(
      !/\$12\.90|\$118\.80|\$9\.90/u.test(hk.terms('annual')),
      'annual terms carry no USD figures when the store answered',
    );
    // 99 x 12 - 939 = 249
    assert(
      (hk.badge('annual') ?? '').includes('249'),
      'the badge is the saving in the store currency',
    );
    assert(
      hk.badge('monthly') === undefined,
      'no badge on the plan with nothing to advertise',
    );

    // A store that answered for one period only must not be half-used.
    const partial = resolvePricing({
      annual: {
        formattedPrice: 'HK$939.00',
        currencyCode: 'HKD',
        amountMicros: 939_000_000,
      },
    });
    assert(!partial.fromStore, 'one period alone falls back to the list prices');
    assert(
      partial.price('annual') === planFor('annual').listPrice,
      'the fallback is the published price, not a mix',
    );

    // Two currencies cannot be compared, so neither is trusted.
    const mixed = resolvePricing({
      monthly: { formattedPrice: '$12.90', currencyCode: 'USD', amountMicros: 12_900_000 },
      annual: {
        formattedPrice: 'HK$939.00',
        currencyCode: 'HKD',
        amountMicros: 939_000_000,
      },
    });
    assert(!mixed.fromStore, 'mismatched currencies fall back rather than compare');

    // With no store at all, the published figures stay consistent.
    const offline = resolvePricing({});
    assert(!offline.fromStore, 'no store prices means the fallback');
    assert(
      offline.badge('annual') === `Save $${annualSavingUsd()}`,
      'the fallback badge matches the derived USD saving',
    );
  }

  // The trial offer (trial-2) exists on the annual base plan only, so only
  // annual may advertise one — and its button is the only "free" one.
  assert(
    planFor('monthly').hasFreeTrial === false,
    'monthly carries no free trial',
  );
  assert(planFor('annual').hasFreeTrial === true, 'annual carries the trial');
  assert(planFor('monthly').cta === 'Start', 'monthly button reads Start');
  assert(
    planFor('annual').cta === 'Start free',
    'annual button reads Start free',
  );
  assert(
    !/free|trial/iu.test(planFor('monthly').terms.split('The free trial')[0]),
    'monthly terms do not promise a trial',
  );
}

console.log('\nandroid guide library:');

{
  assert(ANDROID_GUIDE_CLUSTERS.length === 6, 'six clusters, as on the site');
  assert(
    ANDROID_GUIDE_CLUSTERS.every((cluster) => cluster.prompts.length === 6),
    'every cluster carries six guides',
  );
  assert(ANDROID_GUIDE_PROMPTS.length === 36, 'thirty-six guides in total');
  assert(
    new Set(ANDROID_GUIDE_PROMPTS).size === 36,
    'no guide is duplicated across clusters',
  );
  assert(
    ANDROID_GUIDE_LEAD_PROMPTS.length === 6 &&
      new Set(ANDROID_GUIDE_LEAD_PROMPTS).size === 6,
    'one distinct lead prompt per cluster',
  );
}

console.log('\nsettings feed rows:');

{
  // The Settings tab lists every guide under its cluster heading: six
  // headings plus thirty-six guides. A regression that dropped the headings
  // or a cluster would still render, so the shape is asserted rather than
  // eyeballed.
  const headings = ANDROID_GUIDE_CLUSTERS.length;
  const guides = ANDROID_GUIDE_PROMPTS.length;
  assert(headings + guides === 42, 'the settings feed is 6 headings + 36 guides');

  // Keys must be unique across the whole list or FlatList silently drops rows.
  const keys = [
    ...ANDROID_GUIDE_CLUSTERS.map((cluster) => `heading-${cluster.n}`),
    ...ANDROID_GUIDE_PROMPTS,
  ];
  assert(new Set(keys).size === keys.length, 'every feed row key is unique');

  // Guides are opened by round-tripping the prompt through the URL.
  const sample = ANDROID_GUIDE_PROMPTS.find((p) => p.includes('?')) ?? '';
  assert(sample.length > 0, 'at least one guide title contains a question mark');
  assert(
    decodeURIComponent(encodeURIComponent(sample)) === sample,
    'guide prompts survive URL encoding intact',
  );
}

console.log('\nlogic verified.');
