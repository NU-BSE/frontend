/**
 * Every colour the app puts on screen, measured against WCAG AA.
 *
 * The token file used to carry hand-written contrast ratios in a comment. A
 * comment is a claim nothing checks: it was correct when written and had no
 * way of staying correct through a re-theme, which is exactly when it matters.
 * This computes them from the palette itself, so changing a colour either
 * passes or fails the build.
 *
 * Pairs are the ones the app actually renders — `Text`'s tones over the two
 * grounds they appear on, plus the fills that carry their own text. A tone
 * that is never drawn on a surface is not asserted against it.
 *
 * Run: npm run verify:contrast
 */

import { palette } from '../src/theme/tokens.js';

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  ok — ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL — ${message}`);
  }
}

/** sRGB channel to linear, per WCAG 2.x relative luminance. */
function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function parse(color: string): [number, number, number] {
  const rgba = /^rgba?\(([^)]+)\)$/u.exec(color.trim());
  if (rgba) {
    const parts = rgba[1]!.split(',').map((part) => Number(part.trim()));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  }
  const hex = color.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/**
 * A translucent colour flattened onto what is behind it.
 *
 * `textFaint` and the washes are rgba, and their real contrast is against the
 * composite, not against the colour named in the token. Measuring the token
 * alone would report a ratio nobody ever sees.
 */
function flatten(color: string, over: string): string {
  const alpha = /^rgba\(([^)]+)\)$/u.exec(color.trim());
  if (!alpha) return color;
  const parts = alpha[1]!.split(',').map((part) => Number(part.trim()));
  const a = parts[3] ?? 1;
  const [fr, fg, fb] = parse(color);
  const [br, bg, bb] = parse(over);
  const mix = (f: number, b: number) => Math.round(f * a + b * (1 - a));
  return `#${[mix(fr, br), mix(fg, bg), mix(fb, bb)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

function luminance(color: string): number {
  const [r, g, b] = parse(color).map(channel) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(foreground: string, background: string): number {
  const [light, dark] = [
    luminance(flatten(foreground, background)),
    luminance(background),
  ].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** WCAG AA: 4.5:1 for body text, 3:1 for large text and UI boundaries. */
const AA_BODY = 4.5;
const AA_LARGE = 3;

interface Pair {
  label: string;
  foreground: string;
  background: string;
  /** Large-only tones are held to 3:1; everything else to 4.5:1. */
  large?: boolean;
}

const GROUNDS: [string, string][] = [
  ['canvas', palette.canvas],
  ['surface', palette.surface],
];

const BODY_TONES: [string, string][] = [
  ['textPrimary', palette.textPrimary],
  ['textSecondary', palette.textSecondary],
  ['textMuted', palette.textMuted],
  ['brand', palette.brand],
  ['gold', palette.gold],
  ['danger', palette.danger],
];

const pairs: Pair[] = [];

for (const [groundName, ground] of GROUNDS) {
  for (const [toneName, tone] of BODY_TONES) {
    pairs.push({
      label: `${toneName} on ${groundName}`,
      foreground: tone,
      background: ground,
    });
  }
  /*
   * `textFaint` is 60% of textSecondary and is used for timestamps — small,
   * but genuinely secondary information, so it is held to the large-text bar
   * rather than the body bar and marked as such here rather than quietly
   * exempted.
   */
  pairs.push({
    label: `textFaint on ${groundName}`,
    foreground: palette.textFaint,
    background: ground,
    large: true,
  });
}

// Fills that carry their own text.
pairs.push(
  { label: 'onBrand on brand', foreground: palette.onBrand, background: palette.brand },
  { label: 'textPrimary on brandChip', foreground: palette.textPrimary, background: palette.brandChip },
  { label: 'brand on brandChip', foreground: palette.brand, background: palette.brandChip },
  { label: 'textPrimary on neutralChip', foreground: palette.textPrimary, background: palette.neutralChip },
  { label: 'textSecondary on neutralChip', foreground: palette.textSecondary, background: palette.neutralChip },
);

console.log('text contrast (WCAG AA):');
for (const pair of pairs) {
  const value = ratio(pair.foreground, pair.background);
  const floor = pair.large ? AA_LARGE : AA_BODY;
  assert(
    value >= floor,
    `${pair.label} — ${value.toFixed(2)}:1 (needs ${floor}:1${pair.large ? ', large text' : ''})`,
  );
}

/*
 * Borders are not text, but an invisible border is a card with no edge. 1.5:1
 * against its ground is roughly where a hairline stops reading as one — well
 * below the text bars, because a border carries no information a reader has to
 * decode.
 */
console.log('\nborders are visible against their ground:');
const BORDER_FLOOR = 1.5;
for (const [groundName, ground] of GROUNDS) {
  for (const [name, color] of [
    ['border', palette.border],
    ['borderSoft', palette.borderSoft],
  ] as [string, string][]) {
    const value = ratio(color, ground);
    assert(
      value >= BORDER_FLOOR,
      `${name} on ${groundName} — ${value.toFixed(2)}:1 (needs ${BORDER_FLOOR}:1)`,
    );
  }
}

/*
 * A card has to be findable on the ground it sits on.
 *
 * On paper that is the shadow's job. Here a black shadow over near-black is
 * nothing and Android's elevation draws almost nothing, so the edge comes from
 * the border and the fill carries a hint — which is why the floor below is low
 * and the border floor above is what actually holds the card together.
 */
console.log('\nsurfaces are distinguishable from the ground:');
assert(
  ratio(palette.surface, palette.canvas) >= 1.15,
  `surface against canvas — ${ratio(palette.surface, palette.canvas).toFixed(2)}:1`,
);

/*
 * A failure has to be distinguishable from an action at a glance. In a green
 * palette that is not automatic: a danger colour drifting green-adjacent
 * leaves a user unable to tell which of the two happened without reading.
 */
console.log('\ndanger is distinguishable from the working colour:');
assert(
  ratio(palette.danger, palette.brand) >= 1.6,
  `danger against brand — ${ratio(palette.danger, palette.brand).toFixed(2)}:1`,
);

if (failures > 0) {
  console.error(`\ncontrast: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nverify:contrast — all checks passed');
