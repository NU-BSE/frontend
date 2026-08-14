import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for a future PPTX adapter. */
export interface PptxFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'pptx';
  readonly formats: readonly ['pptx'];
}
