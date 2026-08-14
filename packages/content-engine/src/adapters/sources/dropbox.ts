import type { DocumentSourceAdapter } from '../../contracts/adapters';

/** Dropbox file source boundary (transport only, no processing). */
export interface DropboxSourceAdapter extends DocumentSourceAdapter {
  readonly id: 'dropbox';
}
