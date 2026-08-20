import type { DocumentFormatAdapter } from '../../contracts/adapters';

/**
 * Placeholder contract for a future PDF adapter.
 *
 * Publicly a single adapter, internally split: metadata / text extraction
 * (native) / rendering (native) / mutation (pdf-lib) / OCR (native ML Kit).
 */
export interface PdfFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'pdf';
}
