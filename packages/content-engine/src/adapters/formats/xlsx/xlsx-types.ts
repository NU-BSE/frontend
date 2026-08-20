import type { DocumentLocation } from '../../../contracts/locations';

/**
 * A structured cell value as exposed by the XLSX adapter.
 *
 * The matrix of a spreadsheet chunk uses this union instead of `any`, so a
 * consumer can tell a formula apart from an ordinary value and can rely on
 * `null` meaning "empty cell at this position".
 */
export type XlsxScalar = string | number | boolean;

/** A formula cell keeps the formula and, when present, its cached result. */
export interface XlsxFormulaCell {
  readonly formula: string;
  readonly cached?: XlsxScalar | null;
}

export type XlsxCellValue = XlsxScalar | Date | null | XlsxFormulaCell;

/** One row of a spreadsheet chunk. */
export type XlsxRow = readonly XlsxCellValue[];

/** The structured matrix of a spreadsheet chunk. */
export type XlsxMatrix = readonly XlsxRow[];

/** Per-sheet summary used by `inspect()`. */
export interface XlsxSheetInfo {
  name: string;
  index: number;
  /** Used range in A1 notation (e.g. `A1:C10`), empty string when unused. */
  range: string;
  rowCount: number;
  columnCount: number;
  hidden: boolean;
}

/** Workbook-level structural summary returned in `DocumentInspection.structure`. */
export interface XlsxInspectionStructure {
  sheetCount: number;
  definedNamesCount: number;
  hasFormulas: boolean;
  hasMerges: boolean;
  sheets: readonly XlsxSheetInfo[];
}

/**
 * A bounded read window within a single sheet. Rows are 0-based `[startRow,
 * endRow)`; columns are 0-based inclusive `[startColumn, endColumn]`.
 */
export interface XlsxReadWindow {
  sheetName: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

/**
 * Decoded form of an opaque read/search cursor. Cursors never carry cell
 * content — only structural positions (sheet, row/column indices).
 */
export interface XlsxCursorState {
  version: 1;
  /** Sheet name for validation against the reopened workbook. */
  sheetName: string;
  /** Index of the current sheet in `SheetNames`. */
  sheetIndex: number;
  /** Next row to read, 0-based inclusive. */
  nextRow: number;
  /** Final row bound of the current sheet, 0-based exclusive. */
  endRow: number;
  /** Column bounds of the current sheet, 0-based inclusive. */
  startColumn: number;
  endColumn: number;
  /** Exclusive bound over sheet indices (multi-sheet reads). */
  finalSheetIndex: number;
}

/** Internal representation of a local search hit with its precise address. */
export interface XlsxSearchHit {
  sheet: string;
  cell: string;
  text: string;
  score: number;
}

/** Decoded form of an opaque search cursor (sheet index + cell index). */
export interface XlsxSearchCursorState {
  version: 1;
  sheetIndex: number;
  cellIndex: number;
}

/** The document location shape the XLSX adapter produces. */
export type XlsxLocation = DocumentLocation;

/** Bounds/limits that keep the XLSX adapter memory-safe and progressive. */
export interface XlsxLimits {
  maxRowsPerChunk: number;
  maxCellsPerChunk: number;
  maxTextPerChunk: number;
  maxSearchHits: number;
  maxSearchScanCells: number;
  /** Total used cells in a workbook before a read/search is refused. */
  maxWorkbookCells: number;
  maxSheetNameLength: number;
  /** Hard cap on a single cell's text length for chunk text/search output. */
  maxCellTextLength: number;
}

export const DEFAULT_XLSX_LIMITS: XlsxLimits = {
  maxRowsPerChunk: 200,
  maxCellsPerChunk: 20_000,
  maxTextPerChunk: 80_000,
  maxSearchHits: 200,
  maxSearchScanCells: 250_000,
  maxWorkbookCells: 3_000_000,
  maxSheetNameLength: 31,
  maxCellTextLength: 500,
};
