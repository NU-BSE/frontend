import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for a future Markdown adapter. */
export interface MarkdownFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'markdown';
  readonly formats: readonly ['md'];
}
