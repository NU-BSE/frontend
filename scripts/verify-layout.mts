/**
 * Layout regression test for the onboarding category grid.
 *
 * This runs Yoga — the same layout engine React Native uses — over the exact
 * node structure the screen renders, and asserts the cells actually land side
 * by side. The previous round of this bug shipped with a *correct* arithmetic
 * test: the numbers were right, but the structure they described was not what
 * ran on the device. Computing real frames is what closes that gap.
 *
 * Run: npm run verify:layout
 */
import Yoga, {
  Align,
  Direction,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  Wrap,
} from 'yoga-layout';

import { chunkRows } from '../src/features/scenarios/chunkRows.js';
import { ONBOARDING_SCENARIOS } from '../src/features/scenarios/registry.js';
import { CONNECTOR_CATALOG } from '../src/features/connections/catalog.js';

const GUTTER = 24;
const GAP = 16;
const COLUMNS = 2;
const CELL_MIN_HEIGHT = 144;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Builds the current screen's node tree:
 *   content (padding 24) > grid (gap 16, column) > row (gap 16, row) > cell (flex 1)
 */
function layoutGrid(
  windowWidth: number,
  cellCount: number,
  columns: number = COLUMNS,
  gap: number = GAP,
  cellMinHeight: number = CELL_MIN_HEIGHT,
): Frame[][] {
  const root = Yoga.Node.create();
  root.setWidth(windowWidth);
  root.setPadding(Edge.Horizontal, GUTTER);
  root.setFlexDirection(FlexDirection.Column);

  const grid = Yoga.Node.create();
  grid.setFlexDirection(FlexDirection.Column);
  grid.setGap(Gutter.All, gap);
  root.insertChild(grid, 0);

  const items = Array.from({ length: cellCount }, (_, i) => i);
  const rows = chunkRows(items, columns);
  const cellNodes: ReturnType<typeof Yoga.Node.create>[][] = [];

  rows.forEach((row, rowIndex) => {
    const rowNode = Yoga.Node.create();
    rowNode.setFlexDirection(FlexDirection.Row);
    rowNode.setGap(Gutter.All, gap);
    grid.insertChild(rowNode, rowIndex);

    const nodesInRow: ReturnType<typeof Yoga.Node.create>[] = [];
    row.forEach((cell, columnIndex) => {
      const node = Yoga.Node.create();
      node.setFlexGrow(1);
      node.setFlexShrink(1);
      node.setFlexBasis(0);
      node.setMinWidth(0);
      if (cell !== null) {
        node.setMinHeight(cellMinHeight);
        node.setAlignItems(Align.Center);
        node.setJustifyContent(Justify.Center);
      }
      rowNode.insertChild(node, columnIndex);
      nodesInRow.push(node);
    });
    cellNodes.push(nodesInRow);
  });

  root.calculateLayout(windowWidth, undefined, Direction.LTR);

  const frames = cellNodes.map((row) =>
    row.map((node) => ({
      left: node.getComputedLeft(),
      top: node.getComputedTop(),
      width: node.getComputedWidth(),
      height: node.getComputedHeight(),
    })),
  );

  root.freeRecursive();
  return frames;
}

console.log('chunkRows:');
assert(chunkRows([1, 2, 3, 4, 5, 6], 2).length === 3, 'six items make three rows');
assert(
  chunkRows([1, 2, 3, 4, 5, 6], 2).every((r) => r.length === 2),
  'every row has exactly two slots',
);
const odd = chunkRows([1, 2, 3], 2);
assert(odd.length === 2 && odd[1]![1] === null, 'a short final row is padded');
assert(chunkRows([], 2).length === 0, 'an empty list makes no rows');

/*
 * Driven by the real category count so the test cannot drift from the screen.
 * The odd-count case below still covers a short final row, which four
 * categories no longer produce on their own.
 */
const CATEGORY_COUNT = ONBOARDING_SCENARIOS.length;

console.log(
  `\nyoga layout — ${CATEGORY_COUNT} categories across real device widths:`,
);

for (const windowWidth of [320, 360, 390, 393, 411, 412, 480, 600]) {
  const frames = layoutGrid(windowWidth, CATEGORY_COUNT);

  assert(
    frames.length === Math.ceil(CATEGORY_COUNT / COLUMNS),
    `${windowWidth}pt: ${frames.length} rows for ${CATEGORY_COUNT} categories`,
  );

  const [first, second] = frames[0]!;
  const contentWidth = windowWidth - GUTTER * 2;

  // The actual regression: both cells must share a row, i.e. same top, and the
  // second must start to the right of the first.
  assert(
    first!.top === second!.top,
    `${windowWidth}pt: both cells share a row (top ${first!.top})`,
  );
  assert(
    second!.left > first!.left + first!.width - 0.01,
    `${windowWidth}pt: second cell sits right of the first, not below`,
  );
  // Yoga rounds frames to whole physical pixels, so an odd content width
  // splits as e.g. 165 / 164. That 1pt difference is correct behaviour and
  // invisible; a genuine collapse shows up as a shared `top` failing above.
  assert(
    Math.abs(first!.width - second!.width) <= 1.01,
    `${windowWidth}pt: columns are equal width within rounding (${first!.width.toFixed(1)} / ${second!.width.toFixed(1)}pt)`,
  );
  assert(
    first!.width + second!.width + GAP <= contentWidth + 1.01,
    `${windowWidth}pt: the pair plus the gap fits the content box`,
  );
}

// Figma's own numbers, as a fidelity check rather than a safety one.
const figma = layoutGrid(390, 6)[0]!;
assert(
  Math.abs(figma[0]!.width - 163) < 0.51,
  `390pt window reproduces Figma's 163pt cell (got ${figma[0]!.width.toFixed(1)})`,
);

console.log('\nodd counts:');
const fiveRows = layoutGrid(390, 5);
assert(fiveRows.length === 3, 'five categories still make three rows');
assert(
  Math.abs(fiveRows[2]![0]!.width - fiveRows[0]![0]!.width) <= 1.01,
  'a lone final cell keeps its column width instead of stretching',
);

/**
 * Control: the structure that actually shipped and collapsed.
 *
 * A harness that passes on both the broken and the fixed layout proves
 * nothing, so this rebuilds the old node tree — wrapping row, flexBasis 48%,
 * maxWidth 48.5%, 16pt gap — and asserts it really does stack into one column.
 */
function layoutLegacyGrid(windowWidth: number, cellCount: number): Frame[] {
  const root = Yoga.Node.create();
  root.setWidth(windowWidth);
  root.setPadding(Edge.Horizontal, GUTTER);

  const grid = Yoga.Node.create();
  grid.setFlexDirection(FlexDirection.Row);
  grid.setFlexWrap(Wrap.Wrap);
  grid.setGap(Gutter.All, GAP);
  root.insertChild(grid, 0);

  const nodes = Array.from({ length: cellCount }, (_, i) => {
    const node = Yoga.Node.create();
    node.setWidthPercent(50);
    node.setFlexGrow(1);
    node.setFlexBasisPercent(48);
    node.setMaxWidthPercent(48.5);
    node.setMinHeight(CELL_MIN_HEIGHT);
    grid.insertChild(node, i);
    return node;
  });

  root.calculateLayout(windowWidth, undefined, Direction.LTR);
  const frames = nodes.map((node) => ({
    left: node.getComputedLeft(),
    top: node.getComputedTop(),
    width: node.getComputedWidth(),
    height: node.getComputedHeight(),
  }));
  root.freeRecursive();
  return frames;
}

console.log('\ncontrol — the structure that shipped broken:');
const legacy = layoutLegacyGrid(390, 6);
assert(
  legacy[0]!.top !== legacy[1]!.top,
  'legacy 48.5% + 16pt gap really does drop cell 2 onto its own row',
);
assert(
  legacy.every((f) => f.left === legacy[0]!.left),
  'every legacy cell shares the same left edge — one column, as reported',
);
console.log(
  `  (legacy cell width ${legacy[0]!.width.toFixed(1)}pt, tops ${legacy
    .slice(0, 3)
    .map((f) => f.top)
    .join('/')})`,
);

/*
 * The connectors screen renders the same structure at three columns with a
 * tighter gap. Three cells plus two gaps leave much less slack than two, so
 * this is where an overflow would reappear first — and the grid holds 14
 * entries, which exercises a padded final row (14 = 4 rows of 3, then 2).
 */
const CONNECTOR_COLUMNS = 3;
const CONNECTOR_GAP = 12;
const CONNECTOR_MIN_HEIGHT = 104;
/*
 * Read from the catalogue, not restated. Hardcoded, this measured a synthetic
 * fourteen-cell grid and kept passing while the real screen rendered a
 * different number — the same drift already fixed for the category grid.
 */
const CONNECTOR_COUNT = CONNECTOR_CATALOG.length;

console.log('\nyoga layout — connectors grid, three across:');

for (const windowWidth of [320, 360, 390, 393, 411, 412, 480, 600]) {
  const frames = layoutGrid(
    windowWidth,
    CONNECTOR_COUNT,
    CONNECTOR_COLUMNS,
    CONNECTOR_GAP,
    CONNECTOR_MIN_HEIGHT,
  );

  assert(
    frames.length === Math.ceil(CONNECTOR_COUNT / CONNECTOR_COLUMNS),
    `${windowWidth}pt: ${frames.length} rows for ${CONNECTOR_COUNT} connectors`,
  );

  const [a, b, c] = frames[0]!;

  // All three must share a row — this is the collapse the structure prevents.
  assert(
    a!.top === b!.top && b!.top === c!.top,
    `${windowWidth}pt: all three cells share a row (top ${a!.top})`,
  );
  assert(
    b!.left > a!.left + a!.width - 0.01 && c!.left > b!.left + b!.width - 0.01,
    `${windowWidth}pt: cells run left to right, none wrapped below`,
  );

  // Three cells plus two gaps must fit the content box.
  const contentWidth = windowWidth - GUTTER * 2;
  const spanned = c!.left + c!.width - a!.left;
  assert(
    spanned <= contentWidth + 0.01,
    `${windowWidth}pt: row spans ${spanned.toFixed(1)}pt within ${contentWidth}pt`,
  );
  assert(
    a!.width > 0 && Math.abs(a!.width - c!.width) <= 1.01,
    `${windowWidth}pt: cells are equal width within rounding (${a!.width.toFixed(1)}pt)`,
  );

  // The final row holds 2 real cells + 1 spacer; the real ones must keep the
  // same width as a full row rather than stretching.
  const lastRow = frames[frames.length - 1]!;
  assert(
    Math.abs(lastRow[0]!.width - a!.width) <= 1.01,
    `${windowWidth}pt: padded final row keeps cell width (${lastRow[0]!.width.toFixed(1)}pt)`,
  );
}

// The counter-example: percentage widths at three columns overflow far more
// readily than at two, which is why this grid is structural.
const THREE_COL_PERCENT = 0.333;
const contentAt390 = 390 - GUTTER * 2;
assert(
  contentAt390 * THREE_COL_PERCENT * 3 + CONNECTOR_GAP * 2 > contentAt390,
  'a 33.3% + 12pt-gap rule would overflow at three columns — regression reproduced',
);

console.log('\nlayout verified.');
