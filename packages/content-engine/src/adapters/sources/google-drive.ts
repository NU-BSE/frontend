import type { DocumentSourceAdapter } from '../../contracts/adapters';

/** File discovery/download/upload boundary for Google Drive. */
export interface GoogleDriveSourceAdapter extends DocumentSourceAdapter {
  readonly id: 'google-drive';
  readonly sources: readonly ['google_drive'];
}
