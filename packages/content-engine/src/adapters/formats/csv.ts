import type { BinaryDocument } from '../../contracts/binary-document';
import type { DocumentFormatAdapter } from '../../contracts/adapters';
import type { DocumentCapabilities } from '../../contracts/capabilities';
import type { DocumentRef } from '../../contracts/document-ref';

import { decodeText, looksLikeText } from './shared/decode-text';
import { TextDerivedAdapter } from './shared/text-adapter-base';
import type { TextPiece } from './shared/chunking';

export interface CsvFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'csv';
}

/**
 * Delimiter-separated values, parsed to RFC 4180.
 *
 * The delimiter is sniffed rather than assumed: exports from Russian and
 * European locales use `;` because `,` is the decimal separator there, and
 * reading one of those as comma-separated yields a single column of garbage
 * that still looks like a successful parse.
 *
 * Quoting is handled properly — a quoted field may contain the delimiter, a
 * newline, or a doubled quote. A regex split cannot express that, and one
 * address field is enough to expose it.
 */
export class CsvAdapter extends TextDerivedAdapter implements CsvFormatAdapter {
  readonly id = 'csv' as const;
  protected override readonly defaultKind = 'table' as const;

  async detect(input: BinaryDocument): Promise<boolean> {
    if (!looksLikeText(input.bytes)) return false;
    const name = input.fileName?.toLowerCase() ?? '';
    if (name.endsWith('.csv') || name.endsWith('.tsv')) return true;
    if (input.mimeType?.includes('csv') || input.mimeType?.includes('tab-separated')) {
      return true;
    }
    // Content sniff: two rows that agree on a column count above one.
    const sample = decodeText(input.bytes.slice(0, 4096));
    const rows = parseDelimited(sample, sniffDelimiter(sample));
    return rows.length >= 2 && rows[0]!.length > 1 && rows[0]!.length === rows[1]!.length;
  }

  override async capabilities(document: DocumentRef): Promise<DocumentCapabilities> {
    return { ...(await super.capabilities(document)), tables: true };
  }

  protected parse(input: BinaryDocument): readonly TextPiece[] {
    const text = decodeText(input.bytes);
    const delimiter = sniffDelimiter(text);
    const rows = parseDelimited(text, delimiter);
    if (rows.length === 0) return [];

    // The first row counts as a header only when every cell is non-empty and
    // it differs from the row below; otherwise a headerless export would
    // silently lose its first record.
    const header = rows[0]!;
    const hasHeader =
      rows.length > 1 &&
      header.every((cell) => cell.trim() !== '') &&
      header.join(' ') !== rows[1]!.join(' ') &&
      // A row of numbers is data. Without this an export that starts at its
      // first record silently loses that record to a header it never had.
      !header.every(isNumeric);

    const body = hasHeader ? rows.slice(1) : rows;
    return body.map((row, index) => {
      const rowNumber = hasHeader ? index + 2 : index + 1;
      const labelled = hasHeader
        ? Object.fromEntries(row.map((cell, i) => [header[i] ?? `column${i + 1}`, cell]))
        : row;
      return {
        text: hasHeader
          ? row.map((cell, i) => `${header[i] ?? `column${i + 1}`}: ${cell}`).join('\n')
          : row.join(delimiter),
        structured: labelled,
        location: { range: `row:${rowNumber}` },
      };
    });
  }

  protected summarize(
    pieces: readonly TextPiece[],
    input: BinaryDocument,
  ): Readonly<Record<string, unknown>> {
    const sample = decodeText(input.bytes.slice(0, 8192));
    const delimiter = sniffDelimiter(sample);
    const first = parseDelimited(sample, delimiter)[0] ?? [];
    return { rows: pieces.length, columns: first.length, delimiter };
  }
}

function isNumeric(cell: string): boolean {
  const trimmed = cell.trim();
  return trimmed !== '' && Number.isFinite(Number(trimmed.replace(',', '.')));
}

const TAB = String.fromCharCode(9);
const CANDIDATES: readonly string[] = [',', ';', TAB, '|'];

/**
 * Picks the delimiter that yields the most consistent column count.
 *
 * Counting raw occurrences is not enough — prose full of commas beats a real
 * semicolon-separated file. Parsing a sample with each candidate and
 * preferring the one whose rows agree costs a few milliseconds and gets
 * locale exports right.
 */
export function sniffDelimiter(sample: string): string {
  let best = ',';
  let bestScore = -1;
  for (const candidate of CANDIDATES) {
    const rows = parseDelimited(sample, candidate).slice(0, 20);
    if (rows.length === 0) continue;
    const columns = rows[0]!.length;
    if (columns < 2) continue;
    const consistent = rows.filter((row) => row.length === columns).length;
    const score = consistent * columns;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** RFC 4180 parse: quoted fields may hold the delimiter, newlines and `""`. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    // A trailing newline must not produce a phantom empty row.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i]!;

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      // Consume CRLF as a single terminator.
      if (text[i + 1] === '\n') i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}
