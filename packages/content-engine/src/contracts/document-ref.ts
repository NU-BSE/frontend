export type ContentSource =
  | 'google_drive'
  | 'google_sheets'
  | 'google_docs'
  | 'google_slides'
  | 'local'
  | 'telegram'
  | 'onedrive'
  | 'dropbox'
  | 'generated';

export type DocumentFormat =
  | 'xlsx'
  | 'xls'
  | 'csv'
  | 'google_sheet'
  | 'docx'
  | 'google_doc'
  | 'pdf'
  | 'pptx'
  | 'google_slides'
  | 'txt'
  | 'md'
  | 'html'
  | 'json'
  | 'image'
  | 'unknown';

/**
 * Identity + locator of a document. Deliberately carries no execution
 * decision and no content: where a document physically lives (source), how it
 * is structured (format) and where an operation is executed are three separate
 * concerns. The same document may be inspected locally, read targeted, and
 * saved back through its source — the target belongs to the operation, not the
 * reference.
 */
export interface DocumentRef {
  id: string;
  source: ContentSource;
  sourceId?: string;
  name: string;
  mimeType?: string;
  format?: DocumentFormat;
  revision?: string;
  metadata?: Readonly<Record<string, unknown>>;
}
