import type { DocumentSourceAdapter } from '../../contracts/adapters';

/** Native Google Docs source boundary. */
export interface GoogleDocsSourceAdapter extends DocumentSourceAdapter {
  readonly id: 'google-docs';
  readonly sources: readonly ['google_docs'];
}
