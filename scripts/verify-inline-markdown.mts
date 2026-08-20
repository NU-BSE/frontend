/**
 * Verifies inline `**bold**` parsing.
 *
 * The risk this guards: a naive split on `**` silently eats characters when a
 * marker is unpaired, so `2 ** 8` loses text and a half-typed marker mid-stream
 * makes the tail of a reply disappear while it is still arriving. Text going
 * missing is far worse than emphasis not being applied, so every case here
 * asserts the reassembled text is identical to the input.
 * Run: npm run verify:markdown
 */
import { parseInlineBold } from '../src/features/chat/inlineMarkdown.js';

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  ok — ${message}`);
  } else {
    console.error(`  FAIL — ${message}`);
    failures += 1;
  }
}

function check(input: string, expected: [string, boolean][], label: string): void {
  const segments = parseInlineBold(input);
  const actual = segments.map((s) => [s.text, s.bold] as [string, boolean]);
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (got ${JSON.stringify(actual)})`,
  );
  // Nothing may ever be dropped, whatever the markers look like.
  assert(
    segments.map((s) => s.text).join('') ===
      input.replace(/\*\*([\s\S]+?)\*\*/gu, '$1'),
    `${label} — no characters lost`,
  );
}

console.log('plain and bold:');
check('hello', [['hello', false]], 'plain text is one run');
check('**hi**', [['hi', true]], 'whole string bold');
check('a **b** c', [['a ', false], ['b', true], [' c', false]], 'bold mid-sentence');
check(
  '**a** and **b**',
  [['a', true], [' and ', false], ['b', true]],
  'two bold runs',
);

console.log('\nthe screenshot case:');
check(
  '1) **Android / Google app (Gemini button)**',
  [['1) ', false], ['Android / Google app (Gemini button)', true]],
  'numbered list item with a bold tail',
);
check(
  'Reply with **1–4** (and your device: **Android or iPhone**), and',
  [
    ['Reply with ', false],
    ['1–4', true],
    [' (and your device: ', false],
    ['Android or iPhone', true],
    ['), and', false],
  ],
  'two bold runs in one sentence',
);

console.log('\nmarkers that are not syntax:');
check('2 ** 8 is 256', [['2 ** 8 is 256', false]], 'a lone marker stays literal');
check('trailing **', [['trailing **', false]], 'unclosed marker stays literal');
check('****', [['****', false]], 'empty marker pair stays literal');
check('a ** b ** c', [['a ', false], [' b ', true], [' c', false]], 'spaced markers still pair');

console.log('\nstreaming (a reply arrives one character at a time):');
const full = 'Reply with **1–4** now';
for (let i = 1; i <= full.length; i += 1) {
  const prefix = full.slice(0, i);
  const rebuilt = parseInlineBold(prefix)
    .map((s) => s.text)
    .join('');
  const expected = prefix.replace(/\*\*([\s\S]+?)\*\*/gu, '$1');
  if (rebuilt !== expected) {
    console.error(`  FAIL — prefix ${JSON.stringify(prefix)} lost text`);
    failures += 1;
    break;
  }
}
assert(true, 'no prefix of a streaming reply loses text');

console.log('\nmultiline:');
check(
  '**first**\nplain\n**second**',
  [['first', true], ['\nplain\n', false], ['second', true]],
  'bold runs across lines',
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\ninline markdown verified.');
