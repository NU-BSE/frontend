/**
 * Pure TypeScript/JS processing on the device.
 *
 * Future coverage: TXT, JSON, Markdown, small/medium CSV and XLS/XLSX, simple
 * DOCX semantic read, simple PDF modification (pdf-lib), basic OOXML
 * inspection. Heavy work is avoided on the JS heap — see the native processor.
 */
import type { LocalDocumentProcessor } from './processor';

export interface LocalJsDocumentProcessor extends LocalDocumentProcessor {
  readonly target: 'js';
}
