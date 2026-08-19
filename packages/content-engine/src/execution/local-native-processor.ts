/**
 * Local native processing (Kotlin/Swift) on the device.
 *
 * Reserved for work the JS heap should not hold: large OOXML archives
 * (streamed via `java.util.zip.ZipFile` + `XmlPullParser`), PDF text
 * extraction and rendering (PdfRenderer / PDFBox behind an abstraction),
 * on-device OCR (ML Kit bundled model), and other high-memory operations.
 *
 * The native bridge must return chunked/targeted results, never one giant
 * object graph:
 *
 *   inspectPdf(uri)
 *   readPdfPages(uri, from, to)
 *   searchPdf(uri, query, cursor?)
 *   renderPdfPage(uri, page, options)
 */
import type { LocalDocumentProcessor } from './processor';

export interface LocalNativeDocumentProcessor
  extends LocalDocumentProcessor {
  readonly target: 'native';
}
