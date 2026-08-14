import type { DocumentSourceAdapter } from '../../contracts/adapters';

/** Native Google Sheets source boundary; intended to avoid XLSX export round-trips. */
export interface GoogleSheetsSourceAdapter extends DocumentSourceAdapter {
  readonly id: 'google-sheets';
  readonly sources: readonly ['google_sheets'];
}
