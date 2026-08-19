/**
 * The complete set of inputs for local execution routing.
 *
 * `document` and `operation` are always required; `complexity` and `device`
 * are optional evidence the orchestrator fills in when available. A router
 * must never depend on absent fields, and must never route off-device.
 */
import type { DeviceCapabilities } from '../contracts/capabilities';
import type { DocumentRef } from '../contracts/document-ref';
import type { DocumentSelector } from '../contracts/selectors';

import type { DocumentComplexity } from './document-complexity';

/**
 * The agent-facing operation requested. Mirrors the high-level `document.*`
 * tool surface; routing is per-operation, never per-document.
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
 * A single document operation plus the metadata that influences how (and
 * whether) it can run locally. The same document may route differently per
 * operation: inspecting a 180 MB workbook stays cheap, while materializing
 * every cell may be refused on memory policy.
 */
export interface DocumentOperationDescriptor {
  kind: DocumentOperationKind;

  /** Region of the document the operation touches, when applicable. */
  selector?: DocumentSelector;

  /** The operation needs OCR (scanned/image-based content). */
  requiresOcr?: boolean;

  /** The operation needs a format conversion (e.g. DOC → DOCX). */
  requiresConversion?: boolean;

  /** The operation must see the whole document, not a targeted region. */
  requiresFullDocument?: boolean;

  /** Prefer preserving native formatting/structure in the result. */
  preserveFormatting?: boolean;

  /** Expected output size in bytes, when the operation can estimate it. */
  estimatedOutputSize?: number;

  metadata?: Readonly<Record<string, unknown>>;
}

export interface LocalProcessingContext {
  document: DocumentRef;

  operation: DocumentOperationDescriptor;

  complexity?: DocumentComplexity;

  device?: DeviceCapabilities;
}
