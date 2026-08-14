import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for a future CSV adapter. */
export interface CsvFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'csv';
  readonly formats: readonly ['csv'];
}
