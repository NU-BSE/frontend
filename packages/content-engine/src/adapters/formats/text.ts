import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for a future plain-text adapter (UTF-8). */
export interface TextFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'text';
}
