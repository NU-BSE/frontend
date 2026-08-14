import type { DocumentSourceAdapter } from '../../contracts/adapters';

/**
 * File discovery/download/upload boundary for Google Drive.
 *
 * Transport only — it downloads/upload bytes to the user's Drive. It contains
 * no XLSX/DOCX/PDF parsing; that belongs to the format layer.
 */
export interface GoogleDriveSourceAdapter extends DocumentSourceAdapter {
  readonly id: 'google-drive';
}
