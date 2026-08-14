/**
 * Execution-layer core types.
 *
 * The LLM/MCP surface never learns about these: which target (local, remote,
 * native API) executes a given operation is an internal detail of the
 * Content Engine. These types exist only so the routing layer and processor
 * contracts have a shared vocabulary.
 */
import type { DocumentSelector } from '../contracts/selectors';

/**
 * Where a document operation is physically executed.
 *
 * - `local`     — processed on the device (bytes fetched and parsed locally).
 * - `native-api`— the document is a cloud-native object (Google Sheet/Doc/
 *                 Slides, …) addressed through its provider API, not
 *                 downloaded as a binary file.
 * - `remote`    — processed by a separate backend/document-processing service
 *                 (OCR, conversion, very large documents, long-running jobs).
 */
export type ProcessingTarget = 'local' | 'remote' | 'native-api';

/**
 * The agent-facing operation requested. Mirrors `DocumentEngine` so the
 * routing layer can reason about the operation independently of the document.
 */
export type DocumentOperationKind =
  | 'inspect'
  | 'read'
  | 'search'
  | 'extract'
  | 'create'
  | 'update'
  | 'convert'
  | 'save';

/**
 * A single document operation plus the metadata that influences where it runs.
 * The same document can legitimately route differently per operation: a
 * targeted `read` of a 180 MB workbook may stay local while an `extract` over
 * all rows goes remote.
 */
export interface DocumentOperationDescriptor {
  kind: DocumentOperationKind;

  /** Region of the document the operation touches, when applicable. */
  selector?: DocumentSelector;

  /** The operation needs OCR (implies scanned/image-based content). */
  requiresOcr?: boolean;

  /** The operation needs a format conversion (e.g. DOC → DOCX, Office → PDF). */
  requiresConversion?: boolean;

  /** The operation must see the whole document, not a targeted region. */
  requiresFullDocument?: boolean;

  /** Prefer preserving native formatting/structure in the result. */
  preserveFormatting?: boolean;

  /** Expected output size in bytes, when the operation can estimate it. */
  estimatedOutputSize?: number;

  metadata?: Readonly<Record<string, unknown>>;
}
