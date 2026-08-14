import type { DocumentSourceAdapter } from '../../contracts/adapters';

/** Local Android/device file source boundary. */
export interface LocalSourceAdapter extends DocumentSourceAdapter {
  readonly id: 'local';
  readonly sources: readonly ['local'];
}
