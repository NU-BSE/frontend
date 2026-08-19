import * as XLSX from 'xlsx';

import { DocumentError } from '../../../contracts/errors';
import {
  computeUsedBounds,
  decodeCell,
  decodeRange,
  patchValueToCell,
} from './xlsx-cells';

/** Normalizes SheetJS `write` output (array/buffer) to a `Uint8Array`. */
function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (
    value &&
    typeof value === 'object' &&
    'buffer' in value &&
    'byteLength' in value &&
    'byteOffset' in value
  ) {
    const buffer = (value as { buffer: ArrayBuffer }).buffer;
    const byteOffset = (value as { byteOffset: number }).byteOffset;
    const byteLength = (value as { byteLength: number }).byteLength;
    return new Uint8Array(buffer, byteOffset, byteLength);
  }
  throw new DocumentError(
    'VALIDATION_FAILED',
    'XLSX serialization returned an unexpected value',
  );
}

/**
 * Applies minimal, targeted mutations to a parsed workbook, then serializes it
 * back to XLSX bytes. It never regenerates the workbook from JSON, so
 * formatting, formulas, merges and unknown parts that SheetJS can round-trip
 * survive the edit.
 */
export class XlsxWriter {
  /** Serializes the workbook back to XLSX bytes (always returns a result). */
  writeWorkbook(workbook: XLSX.WorkBook): Uint8Array {
    const out = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'array',
      cellStyles: true,
    });
    return toUint8Array(out);
  }

  setCellValue(
    workbook: XLSX.WorkBook,
    sheetName: string,
    cellAddress: string,
    value: unknown,
  ): void {
    const sheet = this.requireSheet(workbook, sheetName);
    const addr = decodeCell(cellAddress);
    if (!addr) {
      throw new DocumentError('INVALID_SELECTOR', `Invalid cell address "${cellAddress}"`, undefined, {
        cell: cellAddress,
      });
    }

    const cellObj = patchValueToCell(value);
    if (cellObj === null) {
      delete sheet[cellAddress];
      this.recomputeRef(sheet);
      return;
    }

    const existing = sheet[cellAddress] as XLSX.CellObject | undefined;
    if (existing) {
      if (existing.s !== undefined) cellObj.s = existing.s;
      if (
        existing.z !== undefined &&
        (cellObj.t === 'n' || cellObj.t === 'd')
      ) {
        cellObj.z = existing.z;
      }
    }
    sheet[cellAddress] = cellObj;
    this.expandRef(sheet, addr);
  }

  setRange(
    workbook: XLSX.WorkBook,
    sheetName: string,
    range: string,
    values: readonly (readonly unknown[])[],
  ): void {
    const sheet = this.requireSheet(workbook, sheetName);
    const decoded = decodeRange(range);
    if (!decoded) {
      throw new DocumentError('INVALID_SELECTOR', `Invalid range "${range}"`, undefined, {
        range,
      });
    }

    const expectedRows = decoded.e.r - decoded.s.r + 1;
    const expectedCols = decoded.e.c - decoded.s.c + 1;
    if (values.length !== expectedRows) {
      throw new DocumentError(
        'VALIDATION_FAILED',
        `Range "${range}" expects ${expectedRows} row(s) but got ${values.length}`,
        undefined,
        { range, expectedRows, gotRows: values.length },
      );
    }

    for (let r = 0; r < values.length; r += 1) {
      const row = values[r] as readonly unknown[] | undefined;
      if (!row || row.length !== expectedCols) {
        throw new DocumentError(
          'VALIDATION_FAILED',
          `Range "${range}" expects ${expectedCols} column(s) per row`,
          undefined,
          { range, expectedCols, gotCols: row?.length ?? 0 },
        );
      }
    }

    for (let r = 0; r < values.length; r += 1) {
      const row = values[r] as readonly unknown[];
      for (let c = 0; c < row.length; c += 1) {
        const value = row[c];
        const addr = { r: decoded.s.r + r, c: decoded.s.c + c };
        const address = XLSX.utils.encode_cell(addr);
        const cellObj = patchValueToCell(value);
        if (cellObj === null) {
          delete sheet[address];
        } else {
          const existing = sheet[address] as XLSX.CellObject | undefined;
          if (existing) {
            if (existing.s !== undefined) cellObj.s = existing.s;
            if (
              existing.z !== undefined &&
              (cellObj.t === 'n' || cellObj.t === 'd')
            ) {
              cellObj.z = existing.z;
            }
          }
          sheet[address] = cellObj;
        }
      }
    }
    this.expandRef(sheet, decoded.s);
    this.expandRef(sheet, decoded.e);
  }

  addSheet(workbook: XLSX.WorkBook, name: string): void {
    const worksheet = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  }

  renameSheet(workbook: XLSX.WorkBook, from: string, to: string): void {
    const index = workbook.SheetNames.indexOf(from);
    if (index < 0) {
      throw new DocumentError('LOCATION_NOT_FOUND', `Sheet "${from}" not found`, undefined, {
        sheet: from,
      });
    }
    const sheet = workbook.Sheets[from];
    if (!sheet) {
      throw new DocumentError('LOCATION_NOT_FOUND', `Sheet "${from}" not found`, undefined, {
        sheet: from,
      });
    }

    for (const name of workbook.SheetNames) {
      if (name === from) continue;
      const other = workbook.Sheets[name];
      if (!other) continue;
      this.rewriteSheetFormulas(other, from, to);
    }

    const names = workbook.Workbook?.Names;
    if (names) {
      for (const defined of names) {
        if (typeof defined.Ref === 'string') {
          defined.Ref = rewriteSheetRef(defined.Ref, from, to);
        }
      }
    }

    workbook.SheetNames[index] = to;
    delete workbook.Sheets[from];
    workbook.Sheets[to] = sheet;
  }

  private requireSheet(
    workbook: XLSX.WorkBook,
    sheetName: string,
  ): XLSX.WorkSheet {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new DocumentError('LOCATION_NOT_FOUND', `Sheet "${sheetName}" not found`, undefined, {
        sheet: sheetName,
      });
    }
    return sheet;
  }

  /** Grows `!ref` to include `addr`; sets a fresh ref on an empty sheet. */
  private expandRef(sheet: XLSX.WorkSheet, addr: XLSX.CellAddress): void {
    const current = sheet['!ref'];
    if (!current) {
      sheet['!ref'] = XLSX.utils.encode_range({ s: addr, e: addr });
      return;
    }
    let decoded: XLSX.Range;
    try {
      decoded = XLSX.utils.decode_range(current);
    } catch {
      sheet['!ref'] = XLSX.utils.encode_range({ s: addr, e: addr });
      return;
    }
    decoded.s.r = Math.min(decoded.s.r, addr.r);
    decoded.s.c = Math.min(decoded.s.c, addr.c);
    decoded.e.r = Math.max(decoded.e.r, addr.r);
    decoded.e.c = Math.max(decoded.e.c, addr.c);
    sheet['!ref'] = XLSX.utils.encode_range(decoded);
  }

  /** Recomputes `!ref` from populated cells (used after clearing a cell). */
  private recomputeRef(sheet: XLSX.WorkSheet): void {
    const bounds = computeUsedBounds(sheet);
    if (!bounds) {
      delete sheet['!ref'];
      return;
    }
    sheet['!ref'] = XLSX.utils.encode_range({
      s: { r: bounds.minRow, c: bounds.minCol },
      e: { r: bounds.maxRow, c: bounds.maxCol },
    });
  }

  private rewriteSheetFormulas(
    sheet: XLSX.WorkSheet,
    from: string,
    to: string,
  ): void {
    for (const key of Object.keys(sheet)) {
      if (key[0] === '!') continue;
      const cell = sheet[key] as XLSX.CellObject | undefined;
      if (cell && typeof cell.f === 'string') {
        cell.f = rewriteSheetRef(cell.f, from, to);
      }
    }
  }
}

const UNQUOTED_NAME = /^[A-Za-z_][A-Za-z0-9_.]*$/u;
const REF_BOUNDARY = new Set(['(', ',', '=', '+', '-', '*', '/', '^', '&', '<', '>', '%', ':', ' ', '\t']);

function formatSheetRef(name: string): string {
  return `'${name.replace(/'/gu, "''")}'!`;
}

function isRefBoundary(char: string): boolean {
  return REF_BOUNDARY.has(char);
}

/**
 * Rewrites references to a renamed sheet inside a formula. Handles both quoted
 * (`'Old'!A1`) and unquoted (`Old!A1`) forms and never touches string literals
 * (double-quoted) inside the formula.
 */
export function rewriteSheetRef(
  formula: string,
  from: string,
  to: string,
): string {
  if (!formula.includes('!')) return formula;

  let out = '';
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const ch = formula[i] as string;
    if (ch === '"') {
      out += ch;
      i += 1;
      while (i < n && formula[i] !== '"') {
        out += formula[i] as string;
        i += 1;
      }
      if (i < n) {
        out += formula[i] as string;
        i += 1;
      }
      continue;
    }

    if (ch === "'") {
      const end = formula.indexOf("'!", i);
      if (end > i) {
        const inner = formula.slice(i + 1, end).replace(/''/gu, "'");
        if (inner === from) {
          out += formatSheetRef(to);
        } else {
          out += formula.slice(i, end + 2);
        }
        i = end + 2;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    if (
      UNQUOTED_NAME.test(from) &&
      formula.startsWith(`${from}!`, i) &&
      (i === 0 || isRefBoundary(formula[i - 1] as string))
    ) {
      out += formatSheetRef(to);
      i += from.length + 1;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}
