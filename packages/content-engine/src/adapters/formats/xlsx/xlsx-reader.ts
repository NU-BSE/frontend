import * as XLSX from 'xlsx';

import { cellToValue, computeUsedBounds } from './xlsx-cells';
import type {
  XlsxCellValue,
  XlsxMatrix,
  XlsxReadWindow,
  XlsxSheetInfo,
} from './xlsx-types';

const BASE_READ_OPTIONS: XLSX.ParsingOptions = {
  type: 'array',
  cellFormula: true,
  cellDates: true,
  cellNF: true,
  dense: false,
};

const EDIT_READ_OPTIONS: XLSX.ParsingOptions = {
  ...BASE_READ_OPTIONS,
  cellStyles: true,
};

/**
 * Opens a workbook from raw bytes and exposes bounded, sparse-safe reads.
 *
 * The reader is deliberately memory-conscious: it iterates the sparse cell map
 * (`Object.keys(sheet)`) instead of materializing a dense matrix, so a sheet
 * with a huge declared `!ref` but few populated cells is still cheap.
 */
export class XlsxReader {
  openWorkbook(
    bytes: Uint8Array,
    options: { preserveStyles?: boolean } = {},
  ): XLSX.WorkBook {
    const opts = options.preserveStyles
      ? EDIT_READ_OPTIONS
      : BASE_READ_OPTIONS;
    return XLSX.read(bytes, opts);
  }

  sheetNames(workbook: XLSX.WorkBook): readonly string[] {
    return workbook.SheetNames;
  }

  getSheet(
    workbook: XLSX.WorkBook,
    sheetName: string,
  ): XLSX.WorkSheet | undefined {
    return workbook.Sheets[sheetName];
  }

  /** Decoded `!ref`, or `null` when the sheet is unused. */
  usedRange(sheet: XLSX.WorkSheet): XLSX.Range | null {
    const ref = sheet['!ref'];
    if (!ref) return null;
    try {
      return XLSX.utils.decode_range(ref);
    } catch {
      return null;
    }
  }

  /**
   * Accurate used bounds by scanning populated cells. Returns `null` when the
   * sheet has no populated cells. Slower than `usedRange` but not fooled by a
   * stale/empty `!ref` dimension record.
   */
  usedBounds(sheet: XLSX.WorkSheet): {
    minRow: number;
    maxRow: number;
    minCol: number;
    maxCol: number;
  } | null {
    return computeUsedBounds(sheet);
  }

  /** Number of populated cells in a sheet. */
  countUsedCells(sheet: XLSX.WorkSheet): number {
    let count = 0;
    for (const key of Object.keys(sheet)) {
      if (key[0] !== '!') count += 1;
    }
    return count;
  }

  private tryDecodeCell(key: string): XLSX.CellAddress | null {
    try {
      return XLSX.utils.decode_cell(key);
    } catch {
      return null;
    }
  }

  /**
   * Reads a rectangular window into a dense matrix. Empty cells become `null`
   * so column positions are preserved.
   */
  readRows(
    sheet: XLSX.WorkSheet,
    window: XlsxReadWindow,
  ): XlsxMatrix {
    const { startRow, endRow, startColumn, endColumn } = window;
    const rowMap = new Map<number, Map<number, XLSX.CellObject>>();
    for (const key of Object.keys(sheet)) {
      if (key[0] === '!') continue;
      const addr = this.tryDecodeCell(key);
      if (!addr) continue;
      if (addr.r < startRow || addr.r >= endRow) continue;
      if (addr.c < startColumn || addr.c > endColumn) continue;
      let cols = rowMap.get(addr.r);
      if (!cols) {
        cols = new Map();
        rowMap.set(addr.r, cols);
      }
      cols.set(addr.c, sheet[key] as XLSX.CellObject);
    }

    const colSpan = endColumn - startColumn + 1;
    const matrix: XlsxCellValue[][] = [];
    for (let r = startRow; r < endRow; r += 1) {
      const row: XlsxCellValue[] = new Array(colSpan).fill(null);
      const cols = rowMap.get(r);
      if (cols) {
        for (const [c, cell] of cols) {
          row[c - startColumn] = cellToValue(cell);
        }
      }
      matrix.push(row);
    }
    return matrix;
  }

  /** Populated cell addresses sorted by row then column. */
  usedCellsSorted(sheet: XLSX.WorkSheet): XLSX.CellAddress[] {
    const addresses: XLSX.CellAddress[] = [];
    for (const key of Object.keys(sheet)) {
      if (key[0] === '!') continue;
      const addr = this.tryDecodeCell(key);
      if (addr) addresses.push(addr);
    }
    addresses.sort((a, b) => a.r - b.r || a.c - b.c);
    return addresses;
  }

  /** Per-sheet structural summary. */
  listSheets(workbook: XLSX.WorkBook): readonly XlsxSheetInfo[] {
    const props = workbook.Workbook?.Sheets;
    return workbook.SheetNames.map((name, index) => {
      const sheet = workbook.Sheets[name];
      const range = sheet ? this.usedRange(sheet) : null;
      const rowCount = range ? range.e.r - range.s.r + 1 : 0;
      const columnCount = range ? range.e.c - range.s.c + 1 : 0;
      const hidden = props?.[index]?.Hidden === 1 || props?.[index]?.Hidden === 2;
      return {
        name,
        index,
        range: range ? XLSX.utils.encode_range(range) : '',
        rowCount,
        columnCount,
        hidden,
      };
    });
  }

  /** True when the sheet contains at least one formula cell. */
  hasFormulas(sheet: XLSX.WorkSheet): boolean {
    for (const key of Object.keys(sheet)) {
      if (key[0] === '!') continue;
      const cell = sheet[key] as XLSX.CellObject | undefined;
      if (cell && cell.f !== undefined) return true;
    }
    return false;
  }

  mergeCount(sheet: XLSX.WorkSheet): number {
    return sheet['!merges']?.length ?? 0;
  }

  definedNamesCount(workbook: XLSX.WorkBook): number {
    return workbook.Workbook?.Names?.length ?? 0;
  }
}
