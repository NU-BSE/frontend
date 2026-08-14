import type { DocumentFormatAdapter } from '../../contracts/adapters';

/** Placeholder contract for a future HTML adapter. */
export interface HtmlFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'html';
  readonly formats: readonly ['html'];
}
