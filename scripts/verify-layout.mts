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
import { buildConnectorCatalog } from '../src/features/connections/catalog.js';

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
 *
 * Both shapes the screen can render are measured. The custom-server tile
 * appears only when a resolver host is configured, which takes the grid from
 * one full row to two — and the second shape is the riskier one, because its
 * final row is a single real cell beside two spacers.
 */
/*
 * Only the tiles are laid out three across. A full-width entry gets an
 * unpadded row of its own, checked separately below — counting it here would
 * assert the very padding that stops it spanning the width.
 */
const CONNECTOR_SHAPES = [
  {
    label: 'no resolver host',
    count: buildConnectorCatalog({ customServers: false }).filter((e) => !e.fullWidth).length,
  },
  {
    label: 'with custom servers',
    count: buildConnectorCatalog({ customServers: true }).filter((e) => !e.fullWidth).length,
  },
];

for (const shape of CONNECTOR_SHAPES) {
const CONNECTOR_COUNT = shape.count;

console.log(`\nyoga layout — connectors grid, three across (${shape.label}, ${CONNECTOR_COUNT} tiles):`);

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
}


/*
 * The full-width row. A single cell in an unpadded row must reach the whole
 * content box: if a spacer ever crept back in, the tile would sit at a third
 * of the width and look like a connector that failed to load.
 */
console.log('\nyoga layout — full-width connector row:');

for (const windowWidth of [320, 360, 390, 393, 411, 412, 480, 600]) {
  const [row] = layoutGrid(windowWidth, 1, 1, CONNECTOR_GAP, CONNECTOR_MIN_HEIGHT);
  const cell = row![0]!;
  const contentWidth = windowWidth - GUTTER * 2;
  assert(
    Math.abs(cell.width - contentWidth) <= 0.01,
    `${windowWidth}pt: the row spans the full ${contentWidth}pt (got ${cell.width.toFixed(1)}pt)`,
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

/*
 * Device-access rows (app/connect/android.tsx).
 *
 * Each permission used to be a block "Manage" button stacked under its
 * description, which made three permissions read as a form. The status and the
 * affordance now sit beside the text. That is a claim about frames, not about
 * styles, so it is measured: the status column must start to the right of the
 * text column and share its vertical band, and the row must still be tappable.
 */
console.log('\ndevice access rows:');

const ROW_GAP = 12;
const ROW_PADDING_V = 12;
const MIN_TOUCH_TARGET = 48;
const TITLE_HEIGHT = 20;
const DESCRIPTION_HEIGHT = 32;
const STATUS_WIDTH = 62;
const CHEVRON_WIDTH = 8;
const STATUS_GAP = 8;

function layoutAccessRow(windowWidth: number): {
  row: Frame;
  text: Frame;
  status: Frame;
} {
  const root = Yoga.Node.create();
  root.setWidth(windowWidth);
  root.setPadding(Edge.Horizontal, GUTTER);

  const row = Yoga.Node.create();
  row.setFlexDirection(FlexDirection.Row);
  row.setAlignItems(Align.Center);
  row.setJustifyContent(Justify.SpaceBetween);
  row.setGap(Gutter.All, ROW_GAP);
  row.setMinHeight(MIN_TOUCH_TARGET);
  row.setPadding(Edge.Vertical, ROW_PADDING_V);
  root.insertChild(row, 0);

  const text = Yoga.Node.create();
  text.setFlexGrow(1);
  text.setFlexShrink(1);
  text.setFlexBasis(0);
  text.setMinWidth(0);
  text.setFlexDirection(FlexDirection.Column);
  text.setGap(Gutter.All, 4);
  row.insertChild(text, 0);

  const title = Yoga.Node.create();
  title.setHeight(TITLE_HEIGHT);
  text.insertChild(title, 0);
  const description = Yoga.Node.create();
  description.setHeight(DESCRIPTION_HEIGHT);
  text.insertChild(description, 1);

  const status = Yoga.Node.create();
  status.setFlexDirection(FlexDirection.Row);
  status.setAlignItems(Align.Center);
  status.setGap(Gutter.All, STATUS_GAP);
  row.insertChild(status, 1);

  const tag = Yoga.Node.create();
  tag.setWidth(STATUS_WIDTH);
  tag.setHeight(14);
  status.insertChild(tag, 0);
  const chevron = Yoga.Node.create();
  chevron.setWidth(CHEVRON_WIDTH);
  chevron.setHeight(20);
  status.insertChild(chevron, 1);

  root.calculateLayout(windowWidth, undefined, Direction.LTR);
  const frameOf = (node: ReturnType<typeof Yoga.Node.create>): Frame => {
    const c = node.getComputedLayout();
    return { left: c.left, top: c.top, width: c.width, height: c.height };
  };
  return { row: frameOf(row), text: frameOf(text), status: frameOf(status) };
}

for (const windowWidth of [360, 390, 412]) {
  const { row, text, status } = layoutAccessRow(windowWidth);

  // Frames are relative to the row for its children, so compare directly.
  assert(
    status.left >= text.left + text.width - 0.01,
    `${windowWidth}pt: status starts right of the text (${status.left.toFixed(1)} >= ${(text.left + text.width).toFixed(1)})`,
  );
  const statusMid = status.top + status.height / 2;
  assert(
    statusMid > text.top && statusMid < text.top + text.height,
    `${windowWidth}pt: status shares the text's vertical band, so it is beside it and not below`,
  );
  assert(
    row.height >= MIN_TOUCH_TARGET,
    `${windowWidth}pt: row stays tappable (${row.height.toFixed(1)}pt >= ${MIN_TOUCH_TARGET}pt)`,
  );
  assert(
    text.width > 0,
    `${windowWidth}pt: text column keeps positive width (${text.width.toFixed(1)}pt)`,
  );
}

// The counter-example: the old layout put the button in the column flow, so
// the row's height was the sum of its parts rather than the taller of two.
const stacked = TITLE_HEIGHT + DESCRIPTION_HEIGHT + MIN_TOUCH_TARGET + ROW_PADDING_V * 2;
const beside = layoutAccessRow(390).row.height;
assert(
  beside < stacked,
  `beside-the-text is shorter than stacked (${beside.toFixed(0)}pt vs ${stacked}pt) — three of these fit without scrolling`,
);

/*
 * The chat composer.
 *
 * The claims are positional, so they are measured rather than read off the
 * styles: the clip must sit on the FIRST line of the field and at its right
 * edge, and the two controls flanking it must be circles, not the rounded
 * rectangles they replaced.
 */
console.log('\ncomposer:');

const TOUCH = 48;
const BODY_LINE_HEIGHT = 20;
const FIRST_LINE_PADDING = (TOUCH - BODY_LINE_HEIGHT) / 2;
const CLIP_WIDTH = 36;
const ROW_GAP_C = 8;

function layoutComposer(windowWidth: number, lines: number) {
  const root = Yoga.Node.create();
  root.setWidth(windowWidth);
  root.setPadding(Edge.Horizontal, 16);

  const row = Yoga.Node.create();
  row.setFlexDirection(FlexDirection.Row);
  row.setAlignItems(Align.FlexEnd);
  row.setGap(Gutter.All, ROW_GAP_C);
  root.insertChild(row, 0);

  const mic = Yoga.Node.create();
  mic.setWidth(TOUCH);
  mic.setHeight(TOUCH);
  row.insertChild(mic, 0);

  const field = Yoga.Node.create();
  field.setFlexGrow(1);
  field.setFlexShrink(1);
  field.setFlexBasis(0);
  field.setMinWidth(0);
  field.setFlexDirection(FlexDirection.Row);
  // Pinned to the top: this is what keeps the clip on the first line.
  field.setAlignItems(Align.FlexStart);
  field.setMinHeight(TOUCH);
  field.setPadding(Edge.Left, 12);
  row.insertChild(field, 1);

  const input = Yoga.Node.create();
  input.setFlexGrow(1);
  input.setFlexShrink(1);
  input.setFlexBasis(0);
  input.setMinWidth(0);
  input.setPadding(Edge.Vertical, FIRST_LINE_PADDING);
  input.setHeight(FIRST_LINE_PADDING * 2 + BODY_LINE_HEIGHT * lines);
  field.insertChild(input, 0);

  const clip = Yoga.Node.create();
  clip.setWidth(CLIP_WIDTH);
  clip.setHeight(TOUCH);
  field.insertChild(clip, 1);

  const send = Yoga.Node.create();
  send.setWidth(TOUCH);
  send.setHeight(TOUCH);
  row.insertChild(send, 2);

  root.calculateLayout(windowWidth, undefined, Direction.LTR);
  const frameOf = (node: ReturnType<typeof Yoga.Node.create>): Frame => {
    const c = node.getComputedLayout();
    return { left: c.left, top: c.top, width: c.width, height: c.height };
  };
  return {
    row: frameOf(row),
    mic: frameOf(mic),
    field: frameOf(field),
    input: frameOf(input),
    clip: frameOf(clip),
    send: frameOf(send),
  };
}

for (const windowWidth of [360, 390, 412]) {
  const one = layoutComposer(windowWidth, 1);

  assert(
    one.field.height === TOUCH,
    `${windowWidth}pt: a single-line field is exactly one touch target tall (${one.field.height})`,
  );
  // The clip's centre and the first line's centre must coincide, or the glyph
  // sits visibly above or below the text it belongs to.
  const firstLineCentre = one.input.top + FIRST_LINE_PADDING + BODY_LINE_HEIGHT / 2;
  const clipCentre = one.clip.top + one.clip.height / 2;
  assert(
    Math.abs(firstLineCentre - clipCentre) < 0.01,
    `${windowWidth}pt: the clip is centred on the first line (${clipCentre} vs ${firstLineCentre})`,
  );
  assert(
    one.clip.left >= one.input.left + one.input.width - 0.01,
    `${windowWidth}pt: the clip sits to the right of the text`,
  );
  assert(
    one.mic.left < one.field.left && one.send.left > one.field.left + one.field.width - 0.01,
    `${windowWidth}pt: the field sits between the two controls`,
  );
  /*
   * The controls carry no background, so what matters is that the tappable
   * box stays a full touch target — the icon inside is only ~24pt, and
   * letting the box shrink to the glyph would make them hard to hit.
   */
  assert(
    one.mic.width === TOUCH && one.mic.height === TOUCH,
    `${windowWidth}pt: the mic keeps a full touch target behind its icon`,
  );
  assert(
    one.send.width === TOUCH && one.send.height === TOUCH,
    `${windowWidth}pt: the send control keeps a full touch target behind its icon`,
  );

  // The clip must not drift down as the field grows.
  const four = layoutComposer(windowWidth, 4);
  const grownClipCentre = four.clip.top + four.clip.height / 2;
  assert(
    Math.abs(grownClipCentre - clipCentre) < 0.01,
    `${windowWidth}pt: the clip stays on the first line when the field grows`,
  );
  assert(
    four.field.height > one.field.height,
    `${windowWidth}pt: the field does grow with the text`,
  );
}

console.log('\nchat header:');

/*
 * The chat header is a row: a text column (title + status line, and sometimes
 * a "Retry tools" button) and, at the right, "Close".
 *
 * It shipped with the text column unsized — no `flex`, no `flexShrink` — so
 * Yoga sized it by content. A one-word status line ("ON THIS DEVICE") fits and
 * the bug is invisible. An engine failure does not: "On-device inference
 * unavailable: the prompt is larger than the model's context window — too many
 * tools or too long a conversation for on-device inference" wraps to four
 * lines, and the column claiming that intrinsic width pushed "Close" past the
 * right edge of the screen. `alignItems: 'center'` then floated the half-
 * visible button down the middle of the block.
 *
 * Both symptoms are geometry, so both are checkable here. The long line is the
 * real string from onDeviceEngine's describeCompletionFailure, uppercased as
 * the `tag` variant renders it.
 */
const HEADER_GUTTER = 16; // gutter.home
const HEADER_GAP = 12; // spacing.md — headerActions' paddingLeft
const HEADLINE_LINE_HEIGHT = 26; // typography.headline
const TAG_LINE_HEIGHT = 14; // typography.tag
const HEADER_TEXT_GAP = 4; // spacing.xs
const CLOSE_WIDTH = 44; // "Close" at typography.label
const CLOSE_HEIGHT = 20; // typography.label lineHeight

function layoutChatHeader(
  windowWidth: number,
  statusLines: number,
  variant: 'fixed' | 'broken' = 'fixed',
) {
  const broken = variant === 'broken';

  const root = Yoga.Node.create();
  root.setWidth(windowWidth);

  const header = Yoga.Node.create();
  header.setFlexDirection(FlexDirection.Row);
  header.setAlignItems(broken ? Align.Center : Align.FlexStart);
  header.setJustifyContent(Justify.SpaceBetween);
  header.setPadding(Edge.Horizontal, HEADER_GUTTER);
  root.insertChild(header, 0);

  const text = Yoga.Node.create();
  if (!broken) {
    // The whole fix: an unsized column takes its intrinsic width.
    text.setFlexGrow(1);
    text.setFlexShrink(1);
    text.setFlexBasis(0);
    text.setMinWidth(0);
  }
  text.setGap(Gutter.All, HEADER_TEXT_GAP);
  header.insertChild(text, 0);

  const title = Yoga.Node.create();
  title.setHeight(HEADLINE_LINE_HEIGHT);
  // A title is a single line and never widens the column past what is offered.
  title.setWidth(120);
  text.insertChild(title, 0);

  const status = Yoga.Node.create();
  status.setHeight(TAG_LINE_HEIGHT * statusLines);
  // What an unsized column measures: the status line's *unwrapped* width. Four
  // wrapped lines at 360pt is roughly 1,100pt of text laid end to end.
  if (broken) status.setWidth(TAG_LINE_HEIGHT * statusLines * 20);
  text.insertChild(status, 1);

  const actions = Yoga.Node.create();
  actions.setFlexDirection(FlexDirection.Row);
  actions.setAlignItems(Align.Center);
  if (!broken) {
    actions.setFlexShrink(0);
    actions.setPadding(Edge.Left, HEADER_GAP);
  }
  header.insertChild(actions, 1);

  const close = Yoga.Node.create();
  close.setWidth(CLOSE_WIDTH);
  close.setHeight(CLOSE_HEIGHT);
  actions.insertChild(close, 0);

  header.calculateLayout(windowWidth, undefined, Direction.LTR);
  const frameOf = (node: ReturnType<typeof Yoga.Node.create>): Frame => {
    const c = node.getComputedLayout();
    return { left: c.left, top: c.top, width: c.width, height: c.height };
  };
  // Frames are relative to the header, whose own left edge is 0.
  return {
    header: frameOf(header),
    text: frameOf(text),
    title: frameOf(title),
    actions: frameOf(actions),
    close: frameOf(close),
  };
}

for (const windowWidth of [360, 390, 412]) {
  // Four lines is what the on-device context-window failure wraps to at 360pt.
  for (const statusLines of [1, 4]) {
    const frames = layoutChatHeader(windowWidth, statusLines);
    const closeRight =
      frames.actions.left + frames.close.left + frames.close.width;

    assert(
      closeRight <= windowWidth - HEADER_GUTTER + 0.01,
      `${windowWidth}pt/${statusLines}-line status: Close stays inside the gutter (right edge ${closeRight})`,
    );
    assert(
      frames.close.width === CLOSE_WIDTH,
      `${windowWidth}pt/${statusLines}-line status: Close is not shrunk to fit (${frames.close.width})`,
    );
    assert(
      frames.actions.left >= frames.text.left + frames.text.width - 0.01,
      `${windowWidth}pt/${statusLines}-line status: Close does not overlap the text column`,
    );
  }

  // Vertical: the button belongs to the title, not to the middle of a tall
  // error block. Their centres coincide however long the status line grows.
  const tall = layoutChatHeader(windowWidth, 4);
  const titleCentre = tall.text.top + tall.title.top + tall.title.height / 2;
  const closeCentre = tall.actions.top + tall.close.top + tall.close.height / 2;
  assert(
    Math.abs(titleCentre - closeCentre) <= HEADLINE_LINE_HEIGHT / 2,
    `${windowWidth}pt: Close sits level with the title, not the middle of the error (${closeCentre} vs ${titleCentre})`,
  );
}

console.log('\ncontrol — the header that shipped broken:');
{
  const brokenFrames = layoutChatHeader(360, 4, 'broken');
  const closeRight =
    brokenFrames.actions.left +
    brokenFrames.close.left +
    brokenFrames.close.width;
  assert(
    closeRight > 360 - HEADER_GUTTER,
    `an unsized text column really does push Close past the screen edge (right edge ${closeRight.toFixed(0)} of 360)`,
  );

  const titleCentre =
    brokenFrames.text.top + brokenFrames.title.top + brokenFrames.title.height / 2;
  const closeCentre =
    brokenFrames.actions.top +
    brokenFrames.close.top +
    brokenFrames.close.height / 2;
  assert(
    closeCentre - titleCentre > HEADLINE_LINE_HEIGHT / 2,
    `centre alignment really does drop Close below the title (${closeCentre} vs ${titleCentre})`,
  );
}

console.log('\nlayout verified.');
