import type { DocumentSourceAdapter } from '../../contracts/adapters';

/** Backend-managed file source boundary. */
export interface BackendSourceAdapter extends DocumentSourceAdapter {
  readonly id: 'backend';
  readonly sources: readonly ['backend'];
}
