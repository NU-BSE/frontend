import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for a future DOCX adapter. */
export interface DocxFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'docx';
  readonly formats: readonly ['docx'];
}
