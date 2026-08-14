import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for a future CSV/TSV adapter (streaming-capable). */
export interface CsvFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'csv';
}
