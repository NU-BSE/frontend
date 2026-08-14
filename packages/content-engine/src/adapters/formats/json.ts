import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for a future JSON adapter. */
export interface JsonFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'json';
  readonly formats: readonly ['json'];
}
