/**
 * The TypeScript inference must agree with the C++ reference.
 *
 * The model is trained by native/cpp and the app scores it in JS, so the two
 * implementations of the same arithmetic can drift apart silently — a wrong
 * feature order or a missed clamp still returns a plausible number. This runs
 * both over identical inputs and compares.
 *
 * The golden file is produced by the C++ binary. When a compiler is present
 * the binary is rebuilt and re-run, so a change to the C++ that alters its
 * output fails here too rather than only invalidating the port.
 */
/*
 * Node builtins are require()d, not imported: this project's tsconfig carries
 * no node types, and verify-mcp.mts does the same. esbuild bundles to CJS, so
 * the call resolves normally.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

import {
  historyFeatures,
  normalizeCategory,
  predict,
  NotEnoughHistory,
  type ModelBundle,
} from '../src/prediction/inference.js';
import {
  cardForNextCategory,
  dueCategories,
  HORIZON_SECONDS,
} from '../src/prediction/schedule.js';

function assert(condition: boolean, message: string): void {
  console.log(`  ${condition ? 'ok' : 'FAIL'} — ${message}`);
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const BUNDLE_PATH = 'src/prediction/fixtures/category_models.sample.json';
const GOLDEN_PATH = 'src/prediction/fixtures/reference_predictions.json';
const SOURCE = 'src/prediction/native/cpp/cold_start_category_predictor.cpp';

interface Golden {
  category: string;
  timestamps: number[];
  gapSeconds: number;
  predictedAt: number;
  usedGlobalFallback: boolean;
}

const bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8')) as ModelBundle;
const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Golden[];

console.log('TypeScript inference matches the C++ reference:');
for (const example of golden) {
  const got = predict(bundle, example.category, example.timestamps);
  // Both sides do the same double arithmetic in the same order, so the only
  // expected difference is decimal round-tripping through JSON.
  const drift = Math.abs(got.gapSeconds - example.gapSeconds);
  assert(
    drift < 1e-6,
    `${example.category} (${example.timestamps.length} events): gap ${got.gapSeconds.toFixed(3)}s, C++ ${example.gapSeconds.toFixed(3)}s`,
  );
  assert(
    got.usedGlobalFallback === example.usedGlobalFallback,
    `${example.category}: fallback flag agrees (${got.usedGlobalFallback})`,
  );
}

console.log('\nthe C++ still produces the golden file:');
{
  let compiler: string | null = null;
  for (const candidate of ['g++', 'clang++']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      compiler = candidate;
      break;
    } catch {
      // Try the next one.
    }
  }

  if (!compiler || !existsSync(SOURCE)) {
    // Not a silent pass: the port is still checked above against the recorded
    // output, and the message says which half was skipped.
    console.log('  skipped — no C++ compiler on this machine');
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'predictor-'));
    const binary = join(dir, 'predictor');
    execFileSync(compiler, ['-std=c++17', '-O2', '-DNDEBUG', '-o', binary, SOURCE]);

    for (const example of golden) {
      const args = ['predict', '--model', BUNDLE_PATH, '--category', example.category];
      for (const stamp of example.timestamps) args.push('--timestamp', String(stamp));
      const parsed = JSON.parse(execFileSync(binary, args, { encoding: 'utf8' })) as {
        predicted_gap_seconds: number;
      };
      assert(
        Math.abs(parsed.predicted_gap_seconds - example.gapSeconds) < 1e-6,
        `${example.category}: C++ still returns ${example.gapSeconds.toFixed(3)}s`,
      );
    }
  }
}

console.log('\nfeatures refuse to be invented:');
{
  let threw = false;
  try {
    historyFeatures([1700000000, 1700000100]);
  } catch (error) {
    threw = error instanceof NotEnoughHistory;
  }
  assert(threw, 'fewer than three events is not enough history');

  threw = false;
  try {
    historyFeatures([1700000000, 1700000000, 1700000000]);
  } catch (error) {
    threw = error instanceof NotEnoughHistory;
  }
  assert(threw, 'three identical timestamps produce no usable gaps');
}

console.log('\nan unknown category falls back rather than failing:');
{
  const got = predict(bundle, 'Gardening', [1700000000, 1700050000, 1700100000, 1700150000]);
  assert(got.usedGlobalFallback, 'an unseen category uses the global model');
  assert(got.gapSeconds > 0, 'and still produces a positive gap');
  assert(normalizeCategory('Music & Audio') === 'MUSIC_&_AUDIO', 'categories normalize like the trainer');
}

console.log('\nnotifications are derived, never hardcoded:');
{
  const now = 1700039000;
  const events = [
    { packageName: 'org.telegram.messenger', at: 1700000000 },
    { packageName: 'com.google.android.gm', at: 1700010000 },
    { packageName: 'org.telegram.messenger', at: 1700025000 },
    { packageName: 'org.telegram.messenger', at: now },
  ];

  const due = dueCategories(bundle, events, now);
  assert(due.length > 0, 'a category with real history becomes due');
  assert(due[0]!.category === 'COMMUNICATION', 'the category comes from the packages used');

  const card = cardForNextCategory(bundle, events, now);
  assert(card !== null, 'a card is produced');
  // The apps named must be the ones this user actually used, not a fixed list.
  assert(
    card!.text.includes('Telegram') && card!.text.includes('Gmail'),
    'the card names the apps the user actually used',
  );
  assert(
    !card!.text.includes('Slack') && !card!.text.includes('Notion'),
    'and names no app the user has never touched',
  );
  assert(
    (card!.actions ?? []).every((action) => action.label.startsWith('Check ')),
    'every button is generated from a used app',
  );

  // Someone with no history gets no card at all.
  assert(
    cardForNextCategory(bundle, [], now) === null,
    'no usage means no notification',
  );

  // A prediction beyond the horizon is not worth interrupting for.
  const distant = dueCategories(bundle, events, now - HORIZON_SECONDS * 10);
  assert(distant.length === 0, 'a category far in the future is not due');

  /*
   * The unit contract with UsageStatsModule.
   *
   * The native side reports `at` in Unix SECONDS, converted from the
   * platform's milliseconds. Getting that wrong does not throw: milliseconds
   * read as seconds place every event fifty thousand years in the future, and
   * the predictor answers confidently about gaps that never happened. The
   * failure would be a silently useless notification, not an error, so the
   * unit is asserted rather than assumed.
   */
  const asMilliseconds = events.map((event) => ({
    packageName: event.packageName,
    at: event.at * 1000,
  }));
  assert(
    dueCategories(bundle, asMilliseconds, now).length === 0,
    'millisecond timestamps produce nothing — the seconds contract is load-bearing',
  );
  assert(
    events.every((event) => event.at < 4_000_000_000),
    'the fixture itself is in seconds, matching what the native module emits',
  );
}

console.log('\nprediction verified.');
