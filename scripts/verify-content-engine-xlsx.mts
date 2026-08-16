/**
 * End-to-end conformance tests for the XLSX format adapter.
 *
 * Builds synthetic workbooks in-memory (never real user documents) and drives
 * the adapter through detect, inspect, targeted read, search, patch, roundtrip,
 * validation, bad input, encrypted/legacy input and the large-input guard.
 *
 * Run: npm run verify:content-engine:xlsx
 */
/// <reference types="node" />

import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {
  DocumentError,
  XlsxAdapter,
  type DocumentFormatAdapter,
  type DocumentRef,
  type BinaryDocument,
  type XlsxMatrix,
} from '@mobile-agent/content-engine';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  assert(
    actual === expected,
    `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

function assertDeepEq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${message}\n  expected ${b}\n  got      ${a}`);
}

function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return Uint8Array.from(data);
  throw new Error('unexpected XLSX.write output');
}

async function makePlainZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('hello.txt', 'not a spreadsheet');
  return zip.generateAsync({ type: 'uint8array' });
}

function writeXlsx(workbook: XLSX.WorkBook): Uint8Array {
  return toUint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }));
}

const DOC: DocumentRef = {
  id: 'xlsx-fixture',
  source: 'local',
  name: 'fixture.xlsx',
  format: 'xlsx',
};

function binary(bytes: Uint8Array, fileName?: string): BinaryDocument {
  return fileName === undefined
    ? { bytes }
    : { bytes, fileName, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

function simpleWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'Price', 'Qty', 'Active', 'Note'],
    ['Кириллица', 10.5, 2, true, 'русский текст'],
    ['Қазақша мәтін', 20, 3, false, 'қазақ тілі'],
    ['Plain', 30, 4, true, null],
    ['', 40, 5, false, 'trailing'],
  ]);
  ws['F1'] = { t: 's', v: 'Total' };
  ws['F2'] = { t: 'n', f: 'B2*C2', v: 21 };
  ws['F3'] = { t: 'n', f: 'B3*C3', v: 60 };
  ws['!ref'] = 'A1:F5';
  wb.SheetNames.push('Data');
  wb.Sheets['Data'] = ws;
  return wb;
}

function multiSheetWorkbook(): XLSX.WorkBook {
  const wb = simpleWorkbook();
  const summary = XLSX.utils.aoa_to_sheet([
    ['Metric', 'Value'],
    ['Total', 100],
  ]);
  wb.SheetNames.push('Summary');
  wb.Sheets['Summary'] = summary;
  const empty = XLSX.utils.aoa_to_sheet([]);
  wb.SheetNames.push('Empty');
  wb.Sheets['Empty'] = empty;
  return wb;
}

function formattedWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['A', 'B'],
    [1, 2],
  ]);
  ws['B2'].z = '0.00%';
  ws['!cols'] = [{ wch: 20 }, { wch: 30 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  ws['C1'] = { t: 'n', f: 'B2*2', v: 4 };
  ws['!ref'] = 'A1:C2';
  wb.SheetNames.push('Fmt');
  wb.Sheets['Fmt'] = ws;
  return wb;
}

async function main(): Promise<void> {
  const adapter = new XlsxAdapter();

  const simpleBytes = writeXlsx(simpleWorkbook());
  const multiBytes = writeXlsx(multiSheetWorkbook());
  const formattedBytes = writeXlsx(formattedWorkbook());

  console.log('detection:');
  {
    assert(await adapter.detect(binary(simpleBytes)), 'valid xlsx detected');
    assert(
      await adapter.detect(binary(simpleBytes, 'report.txt')),
      'xlsx bytes detected regardless of filename',
    );
    assert(
      !(await adapter.detect(binary(new TextEncoder().encode('hello world'), 'spreadsheet.xlsx'))),
      'text bytes are not xlsx',
    );
    const plainZip = await makePlainZip();
    assert(!(await adapter.detect(binary(plainZip))), 'ordinary zip is not xlsx');
    assert(
      !(await adapter.detect(binary(new TextEncoder().encode('a,b,c\n1,2,3')))),
      'csv is not xlsx',
    );
    assert(!(await adapter.detect(binary(new Uint8Array(0)))), 'empty bytes are not xlsx');
    const fakeZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0]);
    assert(!(await adapter.detect(binary(fakeZip))), 'corrupt zip is not xlsx');
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    assert(!(await adapter.detect(binary(ole))), 'legacy OLE/xls is not xlsx');
  }

  console.log('inspect:');
  {
    const inspection = await adapter.inspect(DOC, binary(multiBytes));
    const structure = inspection.structure as unknown as {
      sheetCount: number;
      hasFormulas: boolean;
      hasMerges: boolean;
      sheets: Array<{ name: string; index: number; range: string; rowCount: number; columnCount: number; hidden: boolean }>;
    };
    assertEq(structure.sheetCount, 3, 'sheet count');
    assertEq(structure.sheets[0]?.name, 'Data', 'first sheet name');
    assertEq(structure.sheets[1]?.name, 'Summary', 'second sheet name');
    assertEq(structure.sheets[2]?.name, 'Empty', 'third sheet name');
    assertEq(structure.sheets[0]?.rowCount, 5, 'Data row count');
    assertEq(structure.sheets[0]?.columnCount, 6, 'Data column count');
    assertEq(structure.sheets[0]?.range, 'A1:F5', 'Data range');
    assertEq(structure.sheets[2]?.rowCount, 0, 'Empty sheet row count');
    assertEq(structure.hasFormulas, true, 'has formulas');
  }

  console.log('targeted read:');
  {
    const r1 = await adapter.read(DOC, binary(simpleBytes), {
      kind: 'spreadsheet',
      sheet: 'Data',
      range: 'A1:C3',
    });
    const m = r1.chunks[0]?.structured as XlsxMatrix;
    assertEq(m?.length, 3, 'range row count');
    assertEq(m?.[1]?.[0], 'Кириллица', 'cyrillic value preserved');
    assertEq(m?.[1]?.[1], 10.5, 'number value preserved');
    assertEq(m?.[1]?.[2], 2, 'integer value preserved');
    assertEq(r1.truncated, false, 'small range not truncated');

    const single = await adapter.read(DOC, binary(simpleBytes), {
      kind: 'spreadsheet',
      sheet: 'Data',
      range: 'D2',
    });
    const sm = single.chunks[0]?.structured as XlsxMatrix;
    assertEq(sm?.[0]?.[0], true, 'single cell boolean');
    assertEq(single.chunks[0]?.location.cell, 'D2', 'single cell location');

    const rows = await adapter.read(DOC, binary(simpleBytes), {
      kind: 'spreadsheet',
      sheet: 'Data',
      rows: { from: 2, to: 3 },
    });
    const rm = rows.chunks[0]?.structured as XlsxMatrix;
    assertEq(rm?.length, 2, 'row window row count');
    assertEq(rm?.[0]?.[0], 'Кириллица', 'row window first row first col');

    const empty = await adapter.read(DOC, binary(multiBytes), {
      kind: 'spreadsheet',
      sheet: 'Empty',
    });
    assertEq(empty.chunks.length, 0, 'empty sheet returns no chunks');

    const all = await adapter.read(DOC, binary(simpleBytes), { kind: 'all' });
    assert(all.truncated === false || all.truncated === true, 'all read returns');
    const combined = await readAllChunks(adapter, DOC, binary(simpleBytes));
    assertEq(combined.totalRows, 5, 'whole workbook row total');

    const multiAll = await readAllChunks(adapter, DOC, binary(multiBytes));
    assertEq(multiAll.totalRows, 7, 'multi-sheet all read crosses sheets via cursor');
  }

  console.log('search:');
  {
    const s1 = await adapter.search(DOC, binary(simpleBytes), 'кириллица');
    assertEq(s1.hits.length, 1, 'case-insensitive cyrillic search');
    assertEq(s1.hits[0]?.location.sheet, 'Data', 'hit sheet');
    assertEq(s1.hits[0]?.location.cell, 'A2', 'hit cell');

    const s2 = await adapter.search(DOC, binary(simpleBytes), 'қазақ');
    assertEq(s2.hits.length, 2, 'kazakh search (two cells contain the term)');
    assert(
      s2.hits.some((h) => h.location.cell === 'A3'),
      'kazakh hit includes A3',
    );

    const s3 = await adapter.search(DOC, binary(simpleBytes), '10.5');
    assertEq(s3.hits.length, 1, 'number-to-text search');

    const s4 = await adapter.search(DOC, binary(simpleBytes), 'B2*C2');
    assert(s4.hits.length >= 1, 'formula text search');
  }

  console.log('patch:');
  {
    const inside = await adapter.applyPatch(DOC, binary(simpleBytes), {
      operations: [{ op: 'set_cell', sheet: 'Data', cell: 'B2', value: 999 }],
    });
    const reopened = XLSX.read(inside.bytes, { type: 'array' });
    assertEq(reopened.Sheets['Data']?.['B2']?.v, 999, 'set_cell inside !ref');

    const outside = await adapter.applyPatch(DOC, binary(simpleBytes), {
      operations: [{ op: 'set_cell', sheet: 'Data', cell: 'Z100', value: 'far' }],
    });
    const reopened2 = XLSX.read(outside.bytes, { type: 'array' });
    assertEq(reopened2.Sheets['Data']?.['Z100']?.v, 'far', 'set_cell outside !ref');
    const ref = XLSX.utils.decode_range(reopened2.Sheets['Data']?.['!ref'] ?? 'A1');
    assertEq(ref.e.r, 99, '!ref expanded to row 100');
    assertEq(ref.e.c, 25, '!ref expanded to column Z');

    const range = await adapter.applyPatch(DOC, binary(simpleBytes), {
      operations: [
        {
          op: 'set_range',
          sheet: 'Data',
          range: 'B2:C3',
          values: [
            [1, 2],
            [3, 4],
          ],
        },
      ],
    });
    const reopened3 = XLSX.read(range.bytes, { type: 'array' });
    assertEq(reopened3.Sheets['Data']?.['C3']?.v, 4, 'set_range applied');

    const added = await adapter.applyPatch(DOC, binary(simpleBytes), {
      operations: [{ op: 'add_sheet', name: 'New Sheet' }],
    });
    const reopened4 = XLSX.read(added.bytes, { type: 'array' });
    assert(reopened4.SheetNames.includes('New Sheet'), 'add_sheet');

    const renamed = await adapter.applyPatch(DOC, binary(simpleBytes), {
      operations: [{ op: 'rename_sheet', from: 'Data', to: 'Renamed' }],
    });
    const reopened5 = XLSX.read(renamed.bytes, { type: 'array' });
    assert(reopened5.SheetNames.includes('Renamed'), 'rename_sheet adds new name');
    assert(!reopened5.SheetNames.includes('Data'), 'rename_sheet removes old name');

    const xref = XLSX.utils.book_new();
    const wsA = XLSX.utils.aoa_to_sheet([['Ref', 1]]);
    wsA['B1'] = { t: 'n', f: "'SheetB'!A1", v: 42 };
    wsA['!ref'] = 'A1:B1';
    xref.SheetNames.push('SheetA', 'SheetB');
    xref.Sheets['SheetA'] = wsA;
    xref.Sheets['SheetB'] = XLSX.utils.aoa_to_sheet([[42]]);
    const renamedRef = await adapter.applyPatch(DOC, binary(writeXlsx(xref)), {
      operations: [{ op: 'rename_sheet', from: 'SheetB', to: 'SheetC' }],
    });
    const reopenedRef = XLSX.read(renamedRef.bytes, { type: 'array', cellFormula: true });
    assertEq(
      reopenedRef.Sheets['SheetA']?.['B1']?.f,
      "'SheetC'!A1",
      'rename rewrites cross-sheet formula reference',
    );

    const multi = await adapter.applyPatch(DOC, binary(simpleBytes), {
      operations: [
        { op: 'set_cell', sheet: 'Data', cell: 'A1', value: 'H1' },
        { op: 'add_sheet', name: 'Extra' },
      ],
    });
    const reopened6 = XLSX.read(multi.bytes, { type: 'array' });
    assertEq(reopened6.Sheets['Data']?.['A1']?.v, 'H1', 'multi op first');
    assert(reopened6.SheetNames.includes('Extra'), 'multi op second');

    await expectDocumentError(
      () =>
        adapter.applyPatch(DOC, binary(simpleBytes), {
          operations: [{ op: 'set_cell', sheet: 'Missing', cell: 'A1', value: 1 }],
        }),
      'LOCATION_NOT_FOUND',
      'invalid sheet',
    );
    await expectDocumentError(
      () =>
        adapter.applyPatch(DOC, binary(simpleBytes), {
          operations: [{ op: 'set_cell', sheet: 'Data', cell: 'not-a-cell', value: 1 }],
        }),
      'INVALID_SELECTOR',
      'invalid cell',
    );
    await expectDocumentError(
      () =>
        adapter.applyPatch(DOC, binary(simpleBytes), {
          operations: [
            { op: 'set_range', sheet: 'Data', range: 'B2:C3', values: [[1]] },
          ],
        }),
      'VALIDATION_FAILED',
      'invalid range size',
    );
    await expectDocumentError(
      () =>
        adapter.applyPatch(DOC, binary(simpleBytes), {
          operations: [{ op: 'add_sheet', name: 'Data' }],
        }),
      'VALIDATION_FAILED',
      'duplicate sheet name',
    );
    await expectDocumentError(
      () =>
        adapter.applyPatch(DOC, binary(simpleBytes), {
          operations: [{ op: 'add_sheet', name: 'Bad[Name]' }],
        }),
      'VALIDATION_FAILED',
      'invalid sheet name',
    );
    await expectDocumentError(
      () =>
        adapter.applyPatch(DOC, binary(simpleBytes), {
          operations: [{ op: 'replace_text', targetId: 'x', text: 'y' }],
        }),
      'UNSUPPORTED_OPERATION',
      'unsupported patch operation',
    );
  }

  console.log('roundtrip:');
  {
    const rt = await adapter.applyPatch(DOC, binary(formattedBytes), { operations: [] });
    const reopened = XLSX.read(rt.bytes, { type: 'array', cellFormula: true, cellNF: true, cellStyles: true });
    const ws = reopened.Sheets['Fmt'];
    assertEq(reopened.SheetNames.length, 1, 'roundtrip sheet count');
    assertEq(ws?.['B2']?.z, '0.00%', 'roundtrip number format');
    assertEq(ws?.['C1']?.f, 'B2*2', 'roundtrip formula');
    assertEq(ws?.['!merges']?.length, 1, 'roundtrip merges');
    assertEq(ws?.['!cols']?.length, 2, 'roundtrip column widths');
  }

  console.log('validation:');
  {
    assert((await adapter.validate(binary(simpleBytes))).valid, 'valid workbook validates');
    const corrupt = simpleBytes.slice(0, 40);
    assert(!(await adapter.validate(binary(corrupt))).valid, 'corrupt workbook invalid');

    const plainZip = await makePlainZip();
    const zipResult = await adapter.validate(binary(plainZip));
    assert(!zipResult.valid, 'plain zip invalid');
    assertEq(zipResult.issues[0]?.code, 'MISSING_WORKBOOK_XML', 'plain zip issue code');

    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    const oleResult = await adapter.validate(binary(ole));
    assert(!oleResult.valid, 'ole invalid');
    assertEq(oleResult.issues[0]?.code, 'ENCRYPTED_OR_LEGACY_XLS', 'ole issue code');

    assert(!(await adapter.validate(binary(new Uint8Array(0)))).valid, 'empty invalid');
  }

  console.log('large-input guard:');
  {
    const big = XLSX.utils.book_new();
    const rows = [];
    for (let r = 0; r < 3000; r += 1) {
      rows.push([r, `row-${r}`, r * 2, r % 7 === 0]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    big.SheetNames.push('Big');
    big.Sheets['Big'] = ws;
    const bigBytes = writeXlsx(big);

    const first = await adapter.read(DOC, binary(bigBytes), { kind: 'spreadsheet', sheet: 'Big' });
    assertEq(first.truncated, true, 'large sheet truncated');
    assert(first.cursor !== undefined, 'large sheet cursor present');
    const total = await readAllChunks(adapter, DOC, binary(bigBytes));
    assertEq(total.totalRows, 3000, 'cursor reads all rows');

    const small = new XlsxAdapter({ maxWorkbookCells: 1000 });
    await expectDocumentError(
      () => small.read(DOC, binary(bigBytes), { kind: 'all' }),
      'MEMORY_LIMIT',
      'workbook cell limit guard',
    );
  }

  console.log('verify:content-engine:xlsx — all checks passed');
}

async function readAllChunks(
  adapter: DocumentFormatAdapter,
  doc: DocumentRef,
  input: BinaryDocument,
): Promise<{ totalRows: number }> {
  let totalRows = 0;
  let cursor: string | undefined;
  let selector: { kind: 'all' } | { kind: 'cursor'; cursor: string } = { kind: 'all' };
  for (let i = 0; i < 1000; i += 1) {
    const result = await adapter.read(doc, input, selector);
    for (const chunk of result.chunks) {
      const matrix = chunk.structured as XlsxMatrix;
      totalRows += matrix.length;
    }
    if (!result.truncated || !result.cursor) break;
    cursor = result.cursor;
    selector = { kind: 'cursor', cursor };
  }
  return { totalRows };
}

async function expectDocumentError(
  fn: () => Promise<unknown>,
  code: string,
  message: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof DocumentError) {
      assertEq(error.code, code, `${message} (error code)`);
      return;
    }
    throw new Error(`FAIL: ${message} (expected DocumentError, got ${String(error)})`);
  }
  throw new Error(`FAIL: ${message} (expected DocumentError, got success)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
