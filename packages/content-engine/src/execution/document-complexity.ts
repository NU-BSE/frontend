/**
 * Document complexity — one of several inputs to execution routing.
 *
 * This is an architectural contract, not a required calculation: adapters fill
 * in the characteristics they can determine, and the router treats every field
 * as optional evidence. File size alone is never sufficient to decide a
 * target; the operation and the device matter equally (see README).
 */
import type { DocumentRef } from '../contracts/document-ref';

export interface DocumentComplexity {
  /** On-disk / on-wire size in bytes. */
  fileSize?: number;

  /** Estimated size once decompressed/expanded, in bytes. */
  estimatedExpandedSize?: number;

  pages?: number;
  sheets?: number;
  rows?: number;
  columns?: number;
  slides?: number;

  /** Number of entries in a ZIP-based container (OOXML). */
  archiveEntries?: number;
  images?: number;

  encrypted?: boolean;
  /** Scanned content (image-only pages) that likely needs OCR. */
  scanned?: boolean;
  /** A text layer is present and searchable. */
  hasTextLayer?: boolean;

  formulaCount?: number;

  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Computes a document's complexity characteristics. The orchestrator calls
 * this before routing so the router has evidence beyond the raw `DocumentRef`.
 * Concrete implementations (per-format adapters, or a light "structure only"
 * inspector) are added later.
 */
export interface DocumentComplexityInspector {
  inspect(document: DocumentRef): Promise<DocumentComplexity>;
}
