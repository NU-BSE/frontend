import type { DocumentSourceAdapter } from '../../contracts/adapters';

/** OneDrive/SharePoint file source boundary. */
export interface OneDriveSourceAdapter extends DocumentSourceAdapter {
  readonly id: 'onedrive';
}
