/**
 * Local execution target: processing on the device.
 *
 * Future flow (not implemented here):
 *
 *   LocalDocumentProcessor
 *        ↓
 *   SourceAdapter        (where the document lives)
 *        ↓
 *   FormatAdapter        (how the document is structured)
 *        ↓
 *   Uint8Array           (BinaryDocument)
 *        ↓
 *   CanonicalDocument / patch
 *
 * Covers TXT/Markdown/JSON/CSV, small-to-medium XLSX/DOCX/PPTX, PDFs with a
 * text layer, and simple create/edit operations.
 */
import type { DocumentProcessor } from './processor';

export interface LocalDocumentProcessor extends DocumentProcessor {
  readonly target: 'local';
}
