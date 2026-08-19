import * as XLSX from 'xlsx';
import JSZip from 'jszip';

import type { DocumentFormatAdapter } from '../../../contracts/adapters';
import type { BinaryDocument } from '../../../contracts/binary-document';
import type { DocumentCapabilities } from '../../../contracts/capabilities';
import type { DocumentChunk } from '../../../contracts/chunks';
import type { DocumentRef } from '../../../contracts/document-ref';
import { DocumentError } from '../../../contracts/errors';
import type { DocumentLocation } from '../../../contracts/locations';
import type { DocumentPatch, DocumentPatchOperation } from '../../../contracts/patches';
import type {
  DocumentInspection,
  DocumentReadResult,
  DocumentSearchHit,
  DocumentSearchResult,
  DocumentValidationResult,
} from '../../../contracts/results';
import type {
  DocumentSelector,
  SpreadsheetSelector,
} from '../../../contracts/selectors';
import { classifyDocument, type DataClassification } from '../../../privacy/data-classification';
import {
  decodeSearchCursor,
  decodeCursor,
  encodeCursor,
  encodeSearchCursor,
} from './xlsx-cursor';
import {
  cellDisplayText,
  cellSearchText,
  cellToValue,
  decodeRange,
  isCellAddress,
  isSupportedPatchValue,
  matrixToText,
  sheetNameError,
} from './xlsx-cells';
import { XlsxReader } from './xlsx-reader';
import type {
  XlsxCellValue,
  XlsxCursorState,
  XlsxInspectionStructure,
  XlsxLimits,
  XlsxMatrix,
} from './xlsx-types';
import { DEFAULT_XLSX_LIMITS } from './xlsx-types';
import { XlsxValidator } from './xlsx-validator';
import { XlsxWriter } from './xlsx-writer';

/**
 * The XLSX (OOXML Spreadsheet) format adapter.
 *
 * End-to-end local processing: detect the container, inspect sheets, read
 * bounded chunks with stable locations, search locally, and apply targeted
 * patches that preserve formatting/formulas/merges as far as SheetJS CE can
 * round-trip them.
 */
export class XlsxAdapter implements DocumentFormatAdapter {
  readonly id = 'xlsx' as const;

  private readonly limits: XlsxLimits;
  private readonly reader = new XlsxReader();
  private readonly writer = new XlsxWriter();
  private readonly validator = new XlsxValidator();

  constructor(limits?: Partial<XlsxLimits>) {
    this.limits = { ...DEFAULT_XLSX_LIMITS, ...limits };
  }

  async detect(input: BinaryDocument): Promise<boolean> {
    const bytes = input.bytes;
    if (bytes.length < 4) return false;
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      return false;
    }

    if (!zip.file('xl/workbook.xml')) return false;

    const contentTypes = zip.file('[Content_Types].xml');
    if (contentTypes) {
      const text = await contentTypes.async('string');
      if (!/spreadsheetml/u.test(text)) return false;
    }

    try {
      const workbook = XLSX.read(bytes, { type: 'array', cellFormula: true });
      return Array.isArray(workbook.SheetNames) && workbook.SheetNames.length > 0;
    } catch {
      return false;
    }
  }

  async capabilities(_document: DocumentRef): Promise<DocumentCapabilities> {
    return {
      inspect: true,
      read: true,
      search: true,
      extract: false,
      create: false,
      update: true,
      preservesFormattingOnUpdate: true,
      tables: true,
      images: false,
      formulas: true,
      sheets: true,
      slides: false,
      targetedRead: true,
      streamingRead: false,
      localIndexing: false,
    };
  }

  async inspect(
    document: DocumentRef,
    input: BinaryDocument,
  ): Promise<DocumentInspection> {
    const workbook = this.reader.openWorkbook(input.bytes);
    const sheets = this.reader.listSheets(workbook);

    let hasFormulas = false;
    let hasMerges = false;
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      if (!hasFormulas && this.reader.hasFormulas(sheet)) hasFormulas = true;
      if (!hasMerges && this.reader.mergeCount(sheet) > 0) hasMerges = true;
    }

    const structure: XlsxInspectionStructure = {
      sheetCount: sheets.length,
      definedNamesCount: this.reader.definedNamesCount(workbook),
      hasFormulas,
      hasMerges,
      sheets,
    };

    return {
      document,
      capabilities: await this.capabilities(document),
      structure: structure as unknown as Readonly<Record<string, unknown>>,
    };
  }

  async read(
    document: DocumentRef,
    input: BinaryDocument,
    selector: DocumentSelector,
  ): Promise<DocumentReadResult> {
    const workbook = this.reader.openWorkbook(input.bytes);
    const classification = classifyDocument(document);

    switch (selector.kind) {
      case 'cursor':
        return this.readFromCursor(workbook, document, classification, selector.cursor);
      case 'spreadsheet':
        return this.readSpreadsheet(workbook, document, classification, selector);
      case 'all':
        return this.readAll(workbook, document, classification);
      default:
        throw new DocumentError(
          'INVALID_SELECTOR',
          `Unsupported selector kind "${(selector as { kind: string }).kind}" for XLSX`,
          undefined,
          { kind: (selector as { kind: string }).kind },
        );
    }
  }

  async search(
    document: DocumentRef,
    input: BinaryDocument,
    query: string,
    cursor?: string,
  ): Promise<DocumentSearchResult> {
    const workbook = this.reader.openWorkbook(input.bytes);
    this.assertWorkbookWithinLimits(workbook);

    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return { document, hits: [] };
    }

    let sheetIndex = 0;
    let cellIndex = 0;
    if (cursor !== undefined) {
      const state = decodeSearchCursor(cursor);
      if (!state) {
        throw new DocumentError('INVALID_SELECTOR', 'Invalid search cursor', undefined, {
          cursor,
        });
      }
      sheetIndex = state.sheetIndex;
      cellIndex = state.cellIndex;
    }

    const hits: DocumentSearchHit[] = [];
    let scanBudget = this.limits.maxSearchScanCells;
    let nextSheetIndex = -1;
    let nextCellIndex = -1;
    let hasMore = false;

    outer: for (let si = sheetIndex; si < workbook.SheetNames.length; si += 1) {
      const name = workbook.SheetNames[si];
      if (name === undefined) continue;
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const cells = this.reader.usedCellsSorted(sheet);
      const startIdx = si === sheetIndex ? cellIndex : 0;
      for (let ci = startIdx; ci < cells.length; ci += 1) {
        if (scanBudget <= 0) {
          nextSheetIndex = si;
          nextCellIndex = ci;
          hasMore = true;
          break outer;
        }
        scanBudget -= 1;

        const addr = cells[ci];
        if (!addr) continue;
        const cell = sheet[XLSX.utils.encode_cell(addr)] as XLSX.CellObject | undefined;
        const value = cellToValue(cell);
        const text = cellSearchText(value, this.limits);
        if (!text) continue;
        const idx = text.toLowerCase().indexOf(needle);
        if (idx < 0) continue;

        const address = XLSX.utils.encode_cell(addr);
        hits.push({
          location: { sheet: name, cell: address, range: address },
          text: text.slice(0, this.limits.maxCellTextLength),
          score: scoreQuery(needle, text),
        });

        if (hits.length >= this.limits.maxSearchHits) {
          if (ci + 1 < cells.length || si + 1 < workbook.SheetNames.length) {
            nextSheetIndex = si;
            nextCellIndex = ci + 1;
            hasMore = true;
          }
          break outer;
        }
      }
    }

    const result: DocumentSearchResult = { document, hits };
    if (hasMore && nextSheetIndex >= 0) {
      result.cursor = encodeSearchCursor({
        version: 1,
        sheetIndex: nextSheetIndex,
        cellIndex: nextCellIndex,
      });
    }
    return result;
  }

  async applyPatch(
    document: DocumentRef,
    input: BinaryDocument,
    patch: DocumentPatch,
  ): Promise<BinaryDocument> {
    const workbook = this.reader.openWorkbook(input.bytes, { preserveStyles: true });

    for (const op of patch.operations) {
      this.validatePatchOp(workbook, op);
    }
    for (const op of patch.operations) {
      this.applyPatchOp(workbook, op);
    }

    let bytes: Uint8Array;
    try {
      bytes = this.writer.writeWorkbook(workbook);
    } catch (error) {
      throw new DocumentError('VALIDATION_FAILED', 'XLSX serialization failed', error);
    }

    const validation = await this.validator.validate({ bytes });
    if (!validation.valid) {
      throw new DocumentError(
        'VALIDATION_FAILED',
        'Post-write validation failed',
        undefined,
        { codes: validation.issues.map((i) => i.code) },
      );
    }

    const reopened = this.reader.openWorkbook(bytes, { preserveStyles: true });
    for (const op of patch.operations) {
      this.verifyPatchOp(reopened, op);
    }

    const result: BinaryDocument = { bytes };
    if (input.fileName !== undefined) result.fileName = input.fileName;
    if (input.mimeType !== undefined) result.mimeType = input.mimeType;
    return result;
  }

  async validate(input: BinaryDocument): Promise<DocumentValidationResult> {
    return this.validator.validate(input);
  }

  // ---- read internals ----------------------------------------------------

  private readSpreadsheet(
    workbook: XLSX.WorkBook,
    document: DocumentRef,
    classification: DataClassification,
    selector: SpreadsheetSelector,
  ): DocumentReadResult {
    const multiSheet = selector.sheet === undefined;
    const sheetName = selector.sheet ?? workbook.SheetNames[0];
    if (sheetName === undefined) {
      return { document, chunks: [], truncated: false, remaining: 0 };
    }
    const sheet = this.reader.getSheet(workbook, sheetName);
    if (!sheet) {
      throw new DocumentError('LOCATION_NOT_FOUND', `Sheet "${sheetName}" not found`, undefined, {
        sheet: sheetName,
      });
    }
    const sheetIndex = workbook.SheetNames.indexOf(sheetName);

    if (selector.range !== undefined && selector.rows !== undefined) {
      throw new DocumentError(
        'INVALID_SELECTOR',
        'Specify either "range" or "rows", not both',
        undefined,
        { sheet: sheetName },
      );
    }

    let startRow = 0;
    let endRow = 0;
    let startColumn = 0;
    let endColumn = 0;

    const bounds = this.reader.usedBounds(sheet);

    if (selector.range !== undefined) {
      const decoded = decodeRange(selector.range);
      if (!decoded) {
        throw new DocumentError('INVALID_SELECTOR', `Invalid range "${selector.range}"`, undefined, {
          range: selector.range,
        });
      }
      startRow = decoded.s.r;
      endRow = decoded.e.r + 1;
      startColumn = decoded.s.c;
      endColumn = decoded.e.c;
    } else if (selector.rows !== undefined) {
      const from = selector.rows.from ?? 1;
      const to = selector.rows.to ?? (bounds ? bounds.maxRow + 1 : 0);
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 1 ||
        to < 1 ||
        from > to
      ) {
        throw new DocumentError(
          'INVALID_SELECTOR',
          'Invalid row window',
          undefined,
          { sheet: sheetName, from, to },
        );
      }
      startRow = from - 1;
      endRow = to;
      if (bounds) {
        startColumn = bounds.minCol;
        endColumn = bounds.maxCol;
      }
    } else if (bounds) {
      endRow = bounds.maxRow + 1;
      startColumn = bounds.minCol;
      endColumn = bounds.maxCol;
    }

    this.assertWindowWithinLimits(startRow, endRow, startColumn, endColumn);

    const state: XlsxCursorState = {
      version: 1,
      sheetName,
      sheetIndex,
      nextRow: startRow,
      endRow,
      startColumn,
      endColumn,
      finalSheetIndex: multiSheet ? workbook.SheetNames.length : sheetIndex + 1,
    };

    return this.emitOneChunk(workbook, document, classification, state);
  }

  private readAll(
    workbook: XLSX.WorkBook,
    document: DocumentRef,
    classification: DataClassification,
  ): DocumentReadResult {
    this.assertWorkbookWithinLimits(workbook);
    if (workbook.SheetNames.length === 0) {
      return { document, chunks: [], truncated: false, remaining: 0 };
    }
    const state = this.initialStateForSheet(workbook, 0, workbook.SheetNames.length);
    if (!state) {
      return { document, chunks: [], truncated: false, remaining: 0 };
    }
    return this.emitOneChunk(workbook, document, classification, state);
  }

  private readFromCursor(
    workbook: XLSX.WorkBook,
    document: DocumentRef,
    classification: DataClassification,
    cursor: string,
  ): DocumentReadResult {
    const state = decodeCursor(cursor);
    if (!state) {
      throw new DocumentError('INVALID_SELECTOR', 'Invalid cursor', undefined, { cursor });
    }
    this.validateCursorState(workbook, state);
    return this.emitOneChunk(workbook, document, classification, state);
  }

  private validateCursorState(
    workbook: XLSX.WorkBook,
    state: XlsxCursorState,
  ): void {
    if (state.sheetIndex >= workbook.SheetNames.length) {
      throw new DocumentError('INVALID_SELECTOR', 'Cursor references a missing sheet', undefined, {
        cursor: encodeCursor(state),
      });
    }
    const name = workbook.SheetNames[state.sheetIndex];
    if (name !== state.sheetName) {
      throw new DocumentError('INVALID_SELECTOR', 'Cursor does not match workbook', undefined, {
        cursor: encodeCursor(state),
      });
    }
    if (state.finalSheetIndex > workbook.SheetNames.length) {
      throw new DocumentError('INVALID_SELECTOR', 'Cursor bounds exceed workbook', undefined, {
        cursor: encodeCursor(state),
      });
    }
  }

  private initialStateForSheet(
    workbook: XLSX.WorkBook,
    sheetIndex: number,
    finalSheetIndex: number,
  ): XlsxCursorState | null {
    const sheetName = workbook.SheetNames[sheetIndex];
    if (sheetName === undefined) return null;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return null;
    const bounds = this.reader.usedBounds(sheet);
    return {
      version: 1,
      sheetName,
      sheetIndex,
      nextRow: 0,
      endRow: bounds ? bounds.maxRow + 1 : 0,
      startColumn: bounds ? bounds.minCol : 0,
      endColumn: bounds ? bounds.maxCol : 0,
      finalSheetIndex,
    };
  }

  private emitOneChunk(
    workbook: XLSX.WorkBook,
    document: DocumentRef,
    classification: DataClassification,
    state: XlsxCursorState,
  ): DocumentReadResult {
    let current = state;
    // Skip empty sheets when continuing a multi-sheet read.
    while (current.sheetIndex < current.finalSheetIndex) {
      const sheetName = workbook.SheetNames[current.sheetIndex];
      const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
      if (!sheet) break;
      if (current.nextRow >= current.endRow) {
        const next = this.initialStateForSheet(
          workbook,
          current.sheetIndex + 1,
          current.finalSheetIndex,
        );
        if (!next) break;
        current = next;
        continue;
      }
      break;
    }

    if (current.sheetIndex >= current.finalSheetIndex) {
      return { document, chunks: [], truncated: false, remaining: 0 };
    }

    const sheetName = workbook.SheetNames[current.sheetIndex];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheetName || !sheet) {
      return { document, chunks: [], truncated: false, remaining: 0 };
    }

    const { matrix, chunkEnd } = this.readChunkRows(
      sheet,
      current.nextRow,
      current.endRow,
      current.startColumn,
      current.endColumn,
    );

    if (matrix.length === 0) {
      const next = this.initialStateForSheet(
        workbook,
        current.sheetIndex + 1,
        current.finalSheetIndex,
      );
      if (next) {
        return this.emitOneChunk(workbook, document, classification, next);
      }
      return { document, chunks: [], truncated: false, remaining: 0 };
    }

    const range = XLSX.utils.encode_range({
      s: { r: current.nextRow, c: current.startColumn },
      e: { r: chunkEnd - 1, c: current.endColumn },
    });

    const location: DocumentLocation = { sheet: sheetName, range };
    if (chunkEnd - current.nextRow === 1 && current.startColumn === current.endColumn) {
      location.cell = XLSX.utils.encode_cell({
        r: current.nextRow,
        c: current.startColumn,
      });
    }

    const chunk: DocumentChunk = {
      documentId: document.id,
      chunkId: `${document.id}:xlsx:${current.sheetIndex}:${current.nextRow}:${chunkEnd}`,
      kind: 'sheet-range',
      structured: matrix,
      text: matrixToText(matrix, this.limits),
      location,
      classification,
    };

    const hasMore =
      chunkEnd < current.endRow ||
      current.sheetIndex + 1 < current.finalSheetIndex;

    const result: DocumentReadResult = {
      document,
      chunks: [chunk],
      truncated: hasMore,
    };

    if (hasMore) {
      let nextState: XlsxCursorState;
      if (chunkEnd < current.endRow) {
        nextState = { ...current, nextRow: chunkEnd };
      } else {
        const next = this.initialStateForSheet(
          workbook,
          current.sheetIndex + 1,
          current.finalSheetIndex,
        );
        if (!next) {
          result.truncated = false;
          return result;
        }
        nextState = next;
      }
      result.cursor = encodeCursor(nextState);
      result.remaining = this.remainingRows(workbook, nextState);
    }

    return result;
  }

  private readChunkRows(
    sheet: XLSX.WorkSheet,
    startRow: number,
    endRow: number,
    startColumn: number,
    endColumn: number,
  ): { matrix: XlsxMatrix; chunkEnd: number } {
    const colSpan = endColumn - startColumn + 1;
    const maxRows = Math.max(
      1,
      Math.min(
        this.limits.maxRowsPerChunk,
        Math.floor(this.limits.maxCellsPerChunk / Math.max(1, colSpan)),
      ),
    );
    const chunkEnd = Math.min(endRow, startRow + maxRows);

    const rowMap = new Map<number, Map<number, XLSX.CellObject>>();
    for (const key of Object.keys(sheet)) {
      if (key[0] === '!') continue;
      let addr: XLSX.CellAddress;
      try {
        addr = XLSX.utils.decode_cell(key);
      } catch {
        continue;
      }
      if (addr.r < startRow || addr.r >= chunkEnd) continue;
      if (addr.c < startColumn || addr.c > endColumn) continue;
      let cols = rowMap.get(addr.r);
      if (!cols) {
        cols = new Map();
        rowMap.set(addr.r, cols);
      }
      cols.set(addr.c, sheet[key] as XLSX.CellObject);
    }

    const matrix: XlsxCellValue[][] = [];
    let textLength = 0;
    let cellCount = 0;
    let row = startRow;
    while (row < chunkEnd) {
      const rowCells: XlsxCellValue[] = new Array(colSpan).fill(null);
      const cols = rowMap.get(row);
      const rowText: string[] = new Array(colSpan).fill('');
      for (let c = 0; c < colSpan; c += 1) {
        const cell = cols?.get(startColumn + c);
        const value = cellToValue(cell);
        rowCells[c] = value;
        rowText[c] = cellDisplayText(value, this.limits);
      }
      const rowTextStr = rowText.join('\t');
      const newCells = cellCount + colSpan;
      const newText = textLength + rowTextStr.length + (matrix.length > 0 ? 1 : 0);
      if (
        matrix.length > 0 &&
        (newCells > this.limits.maxCellsPerChunk ||
          newText > this.limits.maxTextPerChunk)
      ) {
        break;
      }
      matrix.push(rowCells);
      textLength = newText;
      cellCount = newCells;
      row += 1;
    }

    return { matrix, chunkEnd: row };
  }

  private remainingRows(
    workbook: XLSX.WorkBook,
    state: XlsxCursorState,
  ): number {
    let total = 0;
    for (let si = state.sheetIndex; si < state.finalSheetIndex; si += 1) {
      const name = workbook.SheetNames[si];
      if (!name) continue;
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const end = si === state.sheetIndex ? state.endRow : (this.reader.usedBounds(sheet)?.maxRow ?? -1) + 1;
      const start = si === state.sheetIndex ? state.nextRow : 0;
      if (end > start) total += end - start;
    }
    return total;
  }

  // ---- guards ------------------------------------------------------------

  private assertWorkbookWithinLimits(workbook: XLSX.WorkBook): void {
    let total = 0;
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      total += this.reader.countUsedCells(sheet);
      if (total > this.limits.maxWorkbookCells) {
        throw new DocumentError(
          'MEMORY_LIMIT',
          'Workbook exceeds the local processing cell limit',
          undefined,
          { maxWorkbookCells: this.limits.maxWorkbookCells },
        );
      }
    }
  }

  private assertWindowWithinLimits(
    startRow: number,
    endRow: number,
    startColumn: number,
    endColumn: number,
  ): void {
    const rows = Math.max(0, endRow - startRow);
    const cols = Math.max(0, endColumn - startColumn + 1);
    if (rows * cols > this.limits.maxWorkbookCells) {
      throw new DocumentError(
        'MEMORY_LIMIT',
        'Requested range exceeds the local processing cell limit; use a targeted range',
        undefined,
        { maxWorkbookCells: this.limits.maxWorkbookCells },
      );
    }
  }

  // ---- patch internals ---------------------------------------------------

  private validatePatchOp(
    workbook: XLSX.WorkBook,
    op: DocumentPatchOperation,
  ): void {
    switch (op.op) {
      case 'set_cell': {
        if (!workbook.Sheets[op.sheet]) {
          throw new DocumentError('LOCATION_NOT_FOUND', `Sheet "${op.sheet}" not found`, undefined, {
            sheet: op.sheet,
          });
        }
        if (!isCellAddress(op.cell)) {
          throw new DocumentError('INVALID_SELECTOR', `Invalid cell address "${op.cell}"`, undefined, {
            cell: op.cell,
          });
        }
        if (!isSupportedPatchValue(op.value)) {
          throw new DocumentError(
            'VALIDATION_FAILED',
            'Unsupported cell value type',
            undefined,
            { cell: op.cell },
          );
        }
        return;
      }
      case 'set_range': {
        if (!workbook.Sheets[op.sheet]) {
          throw new DocumentError('LOCATION_NOT_FOUND', `Sheet "${op.sheet}" not found`, undefined, {
            sheet: op.sheet,
          });
        }
        const decoded = decodeRange(op.range);
        if (!decoded) {
          throw new DocumentError('INVALID_SELECTOR', `Invalid range "${op.range}"`, undefined, {
            range: op.range,
          });
        }
        if (!Array.isArray(op.values)) {
          throw new DocumentError('VALIDATION_FAILED', 'set_range values must be an array of rows', undefined, {
            range: op.range,
          });
        }
        const expectedRows = decoded.e.r - decoded.s.r + 1;
        const expectedCols = decoded.e.c - decoded.s.c + 1;
        if (op.values.length !== expectedRows) {
          throw new DocumentError(
            'VALIDATION_FAILED',
            `Range "${op.range}" expects ${expectedRows} row(s)`,
            undefined,
            { range: op.range, expectedRows, gotRows: op.values.length },
          );
        }
        for (const row of op.values) {
          if (!Array.isArray(row) || row.length !== expectedCols) {
            throw new DocumentError(
              'VALIDATION_FAILED',
              `Range "${op.range}" expects ${expectedCols} column(s) per row`,
              undefined,
              { range: op.range, expectedCols },
            );
          }
          for (const cellValue of row) {
            if (!isSupportedPatchValue(cellValue)) {
              throw new DocumentError(
                'VALIDATION_FAILED',
                'Unsupported cell value type',
                undefined,
                { range: op.range },
              );
            }
          }
        }
        return;
      }
      case 'add_sheet': {
        const reason = sheetNameError(op.name, workbook.SheetNames, this.limits);
        if (reason) {
          throw new DocumentError(
            'VALIDATION_FAILED',
            `Invalid sheet name "${op.name}"`,
            undefined,
            { name: op.name, reason },
          );
        }
        return;
      }
      case 'rename_sheet': {
        if (!workbook.SheetNames.includes(op.from)) {
          throw new DocumentError('LOCATION_NOT_FOUND', `Sheet "${op.from}" not found`, undefined, {
            sheet: op.from,
          });
        }
        const remaining = workbook.SheetNames.filter((n) => n !== op.from);
        const reason = sheetNameError(op.to, remaining, this.limits);
        if (reason) {
          throw new DocumentError(
            'VALIDATION_FAILED',
            `Invalid sheet name "${op.to}"`,
            undefined,
            { name: op.to, reason },
          );
        }
        return;
      }
      default:
        throw new DocumentError(
          'UNSUPPORTED_OPERATION',
          `Unsupported patch operation "${(op as { op: string }).op}" for XLSX`,
          undefined,
          { op: (op as { op: string }).op },
        );
    }
  }

  private applyPatchOp(
    workbook: XLSX.WorkBook,
    op: DocumentPatchOperation,
  ): void {
    switch (op.op) {
      case 'set_cell':
        this.writer.setCellValue(workbook, op.sheet, op.cell, op.value);
        return;
      case 'set_range':
        this.writer.setRange(workbook, op.sheet, op.range, op.values);
        return;
      case 'add_sheet':
        this.writer.addSheet(workbook, op.name);
        return;
      case 'rename_sheet':
        this.writer.renameSheet(workbook, op.from, op.to);
        return;
      default:
        throw new DocumentError(
          'UNSUPPORTED_OPERATION',
          `Unsupported patch operation "${(op as { op: string }).op}" for XLSX`,
        );
    }
  }

  private verifyPatchOp(
    workbook: XLSX.WorkBook,
    op: DocumentPatchOperation,
  ): void {
    switch (op.op) {
      case 'set_cell': {
        const sheet = workbook.Sheets[op.sheet];
        const actual = cellToValue(sheet?.[op.cell] as XLSX.CellObject | undefined);
        if (!valuesEqual(actual, op.value)) {
          throw new DocumentError(
            'VALIDATION_FAILED',
            'Mutation verification failed for set_cell',
            undefined,
            { sheet: op.sheet, cell: op.cell },
          );
        }
        return;
      }
      case 'set_range': {
        const sheet = workbook.Sheets[op.sheet];
        if (!sheet) {
          throw new DocumentError('LOCATION_NOT_FOUND', `Sheet "${op.sheet}" not found`);
        }
        const decoded = decodeRange(op.range);
        if (!decoded) {
          throw new DocumentError('VALIDATION_FAILED', 'Mutation verification failed for set_range');
        }
        for (let r = 0; r < op.values.length; r += 1) {
          const row = op.values[r] as readonly unknown[];
          for (let c = 0; c < row.length; c += 1) {
            const address = XLSX.utils.encode_cell({
              r: decoded.s.r + r,
              c: decoded.s.c + c,
            });
            const actual = cellToValue(sheet[address] as XLSX.CellObject | undefined);
            if (!valuesEqual(actual, row[c])) {
              throw new DocumentError(
                'VALIDATION_FAILED',
                'Mutation verification failed for set_range',
                undefined,
                { sheet: op.sheet, range: op.range, cell: address },
              );
            }
          }
        }
        return;
      }
      case 'add_sheet': {
        if (!workbook.SheetNames.includes(op.name)) {
          throw new DocumentError('VALIDATION_FAILED', 'Mutation verification failed for add_sheet');
        }
        return;
      }
      case 'rename_sheet': {
        if (
          !workbook.SheetNames.includes(op.to) ||
          workbook.SheetNames.includes(op.from)
        ) {
          throw new DocumentError('VALIDATION_FAILED', 'Mutation verification failed for rename_sheet');
        }
        return;
      }
      default:
        throw new DocumentError(
          'UNSUPPORTED_OPERATION',
          `Unsupported patch operation "${(op as { op: string }).op}" for XLSX`,
        );
    }
  }
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (expected === null || expected === undefined) return actual === null;
  if (expected instanceof Date) {
    return actual instanceof Date && actual.getTime() === expected.getTime();
  }
  if (actual === null) return false;
  if (typeof expected === 'number') {
    return typeof actual === 'number' && actual === expected;
  }
  if (typeof expected === 'boolean') {
    return typeof actual === 'boolean' && actual === expected;
  }
  if (typeof expected === 'string') {
    return typeof actual === 'string' && actual === expected;
  }
  return false;
}

function scoreQuery(needle: string, text: string): number {
  const lower = text.toLowerCase();
  if (lower === needle) return 1;
  const idx = lower.indexOf(needle);
  if (idx === 0) return 0.9;
  if (idx > 0) {
    const prev = lower[idx - 1] as string;
    if (!/[a-zа-яё0-9_]/iu.test(prev)) return 0.75;
  }
  return 0.6;
}
