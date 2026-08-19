import type { DocumentSourceAdapter } from '../../contracts/adapters';

/**
 * Native Google Sheets source boundary.
 *
 * A Google Sheet is addressed through the Sheets API (structured values /
 * metadata), not necessarily exported to XLSX. The device fetches only the
 * required ranges; reasoning stays local.
 */
export interface GoogleSheetsSourceAdapter extends DocumentSourceAdapter {
  readonly id: 'google-sheets';
}
