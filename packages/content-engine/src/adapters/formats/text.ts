import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for a future plain-text adapter. */
export interface TextFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'text';
  readonly formats: readonly ['txt'];
}
