import type { DocumentSourceAdapter } from '../../contracts/adapters';

/** Native Google Slides source boundary. */
export interface GoogleSlidesSourceAdapter extends DocumentSourceAdapter {
  readonly id: 'google-slides';
}
