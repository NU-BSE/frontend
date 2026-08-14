import type { DocumentSourceAdapter } from '../../contracts/adapters';

/** Local Android/device file source boundary (app-private storage). */
export interface LocalSourceAdapter extends DocumentSourceAdapter {
  readonly id: 'local';
}
