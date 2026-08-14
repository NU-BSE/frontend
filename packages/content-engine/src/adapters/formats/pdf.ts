import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for a future PDF adapter. */
export interface PdfFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'pdf';
  readonly formats: readonly ['pdf'];
}
