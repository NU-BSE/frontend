import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for a future XLS/XLSX workbook adapter. */
export interface XlsxFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'xlsx';
}
