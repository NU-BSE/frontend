/**
 * Native API execution target: cloud-native documents addressed through their
 * provider API rather than downloaded and parsed as binary files.
 *
 * Google Sheets/ Docs / Slides are the canonical examples; Microsoft Excel
 * Online, Word Online, Notion and other cloud document APIs may join later.
 *
 * Critical architectural principle: a Google Sheet must NOT be forced through
 * the round-trip
 *
 *   Google Sheet → export XLSX → download → XlsxAdapter
 *
 * for every operation. The preferred flow is
 *
 *   Google Sheet → NativeApiDocumentProcessor → Google Sheets Adapter/API
 */
import type { DocumentProcessor } from './processor';

export interface NativeApiDocumentProcessor extends DocumentProcessor {
  readonly target: 'native-api';
}
