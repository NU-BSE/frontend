import * as XLSX from 'xlsx';

import type {
  XlsxCellValue,
  XlsxFormulaCell,
  XlsxLimits,
  XlsxScalar,
} from './xlsx-types';
import { DEFAULT_XLSX_LIMITS } from './xlsx-types';

/**
 * Internal cell value conversions shared by the reader, writer and adapter.
 * Keeps `any` out of the public matrix and enforces a single, consistent
 * semantics for how a SheetJS cell maps to a structured value.
 */

function scalarize(value: unknown): XlsxScalar | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  return null;
}

function formulaCell(cell: XLSX.CellObject): XlsxFormulaCell {
  return {
    formula: cell.f ?? '',
    cached: scalarize(cell.v),
  };
}

/** Maps a SheetJS cell object to a structured, JSON-friendly value. */
export function cellToValue(cell: XLSX.CellObject | undefined): XlsxCellValue {
  if (!cell) return null;
  if (cell.f !== undefined) return formulaCell(cell);

  const v = cell.v;
  switch (cell.t) {
    case 'b':
      return v === true || v === 1;
    case 'n':
      return typeof v === 'number' ? v : Number(v);
    case 'd':
      return v instanceof Date
        ? v
        : typeof v === 'number'
          ? new Date(v)
          : null;
    case 'e':
      return typeof cell.w === 'string' && cell.w.length > 0
        ? cell.w
        : String(v ?? '');
    case 's':
      return v == null ? null : String(v);
    case 'z':
      return null;
    default:
      if (v == null) return null;
      if (typeof v === 'object') {
        if (v instanceof Date) return v;
        return null;
      }
      return scalarize(v);
  }
}

/** Maps a patch value to a SheetJS cell object; `null` means "clear the cell". */
export function patchValueToCell(value: unknown): XLSX.CellObject | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return { t: 's', v: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return { t: 'n', v: value };
  }
  if (typeof value === 'boolean') return { t: 'b', v: value };
  if (value instanceof Date) return { t: 'd', v: value };
  return null;
}

/** Whether a patch value is representable as a single spreadsheet cell. */
export function isSupportedPatchValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return value instanceof Date;
}

function clampText(text: string, limits: XlsxLimits): string {
  const singleLine = text
    .replace(/\r\n|\r|\n/gu, ' ')
    .replace(/\t/gu, ' ');
  if (singleLine.length <= limits.maxCellTextLength) return singleLine;
  return `${singleLine.slice(0, limits.maxCellTextLength)}…`;
}

/** Compact single-line text used for chunk `text` (TSV) output. */
export function cellDisplayText(
  value: XlsxCellValue,
  limits: XlsxLimits = DEFAULT_XLSX_LIMITS,
): string {
  if (value === null) return '';
  if (typeof value === 'string') return clampText(value, limits);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const cached = value.cached;
    if (cached === null || cached === undefined) return '';
    return clampText(String(cached), limits);
  }
  return '';
}

/** Searchable text: includes the formula text itself for formula cells. */
export function cellSearchText(
  value: XlsxCellValue,
  limits: XlsxLimits = DEFAULT_XLSX_LIMITS,
): string {
  if (value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const parts = [value.formula];
    if (value.cached !== null && value.cached !== undefined) {
      parts.push(String(value.cached));
    }
    return clampText(parts.join(' '), limits);
  }
  if (typeof value === 'string') return clampText(value, limits);
  return String(value);
}

/** Compact TSV-like text of a chunk matrix (nulls become empty fields). */
export function matrixToText(
  matrix: readonly (readonly XlsxCellValue[])[],
  limits: XlsxLimits = DEFAULT_XLSX_LIMITS,
): string {
  return matrix
    .map((row) => row.map((v) => cellDisplayText(v, limits)).join('\t'))
    .join('\n');
}

const INVALID_SHEET_NAME_CHARS = /[[\]*?/\\:]/u;

/**
 * Validates an Excel sheet name. Returns `null` when valid, otherwise a
 * machine-readable reason string.
 */
export function sheetNameError(
  name: string,
  existingNames: readonly string[],
  limits: XlsxLimits = DEFAULT_XLSX_LIMITS,
): string | null {
  if (name.length === 0) return 'empty_name';
  if (name.length > limits.maxSheetNameLength) return 'name_too_long';
  if (name.startsWith("'") || name.endsWith("'")) return 'invalid_quotes';
  if (INVALID_SHEET_NAME_CHARS.test(name)) return 'invalid_characters';
  if (existingNames.includes(name)) return 'duplicate_name';
  return null;
}

/** Validates an A1 cell address; returns `false` for invalid input. */
export function isCellAddress(address: string): boolean {
  if (typeof address !== 'string' || address.length === 0) return false;
  try {
    const decoded = XLSX.utils.decode_cell(address);
    return decoded.r >= 0 && decoded.c >= 0;
  } catch {
    return false;
  }
}

/** Decodes an A1 cell address, returning `null` on invalid input. */
export function decodeCell(address: string): XLSX.CellAddress | null {
  if (!isCellAddress(address)) return null;
  return XLSX.utils.decode_cell(address);
}

/** Decodes an A1 range, returning `null` on invalid input. */
export function decodeRange(range: string): XLSX.Range | null {
  if (typeof range !== 'string' || range.length === 0) return null;
  try {
    const decoded = XLSX.utils.decode_range(range);
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Accurate used bounds of a sheet by scanning populated cells. Returns `null`
 * for an empty sheet. More reliable than `!ref` when the file carries a stale
 * or empty dimension record.
 */
export function computeUsedBounds(sheet: XLSX.WorkSheet): {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
} | null {
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = -1;
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = -1;
  for (const key of Object.keys(sheet)) {
    if (key[0] === '!') continue;
    let addr: XLSX.CellAddress;
    try {
      addr = XLSX.utils.decode_cell(key);
    } catch {
      continue;
    }
    if (addr.r < minRow) minRow = addr.r;
    if (addr.r > maxRow) maxRow = addr.r;
    if (addr.c < minCol) minCol = addr.c;
    if (addr.c > maxCol) maxCol = addr.c;
  }
  if (maxRow < 0 || maxCol < 0) return null;
  return { minRow, maxRow, minCol, maxCol };
}
