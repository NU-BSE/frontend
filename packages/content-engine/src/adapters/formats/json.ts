import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for a future JSON adapter (native JSON.parse). */
export interface JsonFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'json';
}
