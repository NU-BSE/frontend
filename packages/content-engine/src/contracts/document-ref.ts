export type ContentSource =
  | 'google_drive'
  | 'google_sheets'
  | 'google_docs'
  | 'google_slides'
  | 'local'
  | 'backend'
  | 'telegram'
  | 'onedrive'
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
