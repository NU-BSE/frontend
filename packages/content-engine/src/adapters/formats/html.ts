import type { DocumentFormatAdapter } from '../../contracts/adapters';

/**
 * Placeholder contract for a future HTML adapter.
 *
 * The concrete parser is chosen after a Hermes-compatibility spike; contracts
 * are deliberately not coupled to a specific HTML library.
 */
export interface HtmlFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'html';
}
