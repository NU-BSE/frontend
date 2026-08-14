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

/**
 * The canonical binary payload of a document, shared by source and format
 * adapters. Based on `Uint8Array` so it is identical across React Native /
 * Hermes, browsers, Node backends and Web Workers. A `Buffer` (Node-only) may
 * exist only inside a concrete adapter/processor, never in these contracts.
 *
 * Native cloud documents (e.g. Google Sheets) are typically *not* represented
 * as a `BinaryDocument`: they are processed through the native API path
 * (`native-api` execution target) instead of being downloaded and parsed.
 */
export interface BinaryDocument {
  bytes: Uint8Array;
  mimeType?: string;
  fileName?: string;
}
