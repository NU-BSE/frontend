/**
 * Synthetic test fixtures — descriptors only, never real user documents.
 *
 * Fixtures describe the minimal documents each adapter must handle. They carry
 * metadata (format, size, complexity) but no binary content here; actual
 * fixture binaries are generated/committed with the first implementation PR.
 */
import type { DocumentFormat } from '../contracts/document-ref';
import type { DocumentComplexity } from '../execution/document-complexity';

export interface DocumentFixture {
  name: string;
  format: DocumentFormat;
  sizeBytes?: number;
  complexity?: Partial<DocumentComplexity>;
}

export const SYNTHETIC_FIXTURES: readonly DocumentFixture[] = [
  { name: 'simple.xlsx', format: 'xlsx', complexity: { sheets: 1, rows: 50, columns: 5 } },
  { name: 'formulas.xlsx', format: 'xlsx', complexity: { sheets: 1, formulaCount: 12 } },
  { name: 'formatted.xlsx', format: 'xlsx', complexity: { sheets: 1 } },
  { name: 'merged-cells.xlsx', format: 'xlsx', complexity: { sheets: 1 } },
  { name: 'simple.docx', format: 'docx', complexity: { pages: 2 } },
  { name: 'tables.docx', format: 'docx', complexity: { pages: 3 } },
  { name: 'images.docx', format: 'docx', complexity: { pages: 4, images: 3 } },
  { name: 'simple.pdf', format: 'pdf', complexity: { pages: 2, hasTextLayer: true } },
  { name: 'scanned-one-page.pdf', format: 'pdf', complexity: { pages: 1, scanned: true, hasTextLayer: false } },
  { name: 'simple.pptx', format: 'pptx', complexity: { slides: 4 } },
  { name: 'utf8.csv', format: 'csv', complexity: { rows: 100, columns: 3 } },
  { name: 'quoted.csv', format: 'csv', complexity: { rows: 200, columns: 6 } },
];
