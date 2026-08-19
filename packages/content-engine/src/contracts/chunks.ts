/**
 * The chunk model — the primary unit the engine hands to the local model.
 *
 * A document is *not* materialized into one huge `CanonicalDocument`; instead
 * progressive processing (inspect → targeted read → chunk → retrieval → model)
 * produces bounded chunks. Every chunk carries a stable `location` so the
 * model can later refer back to it for a targeted edit.
 */
import type { DataClassification } from '../privacy/data-classification';
import type { DocumentLocation } from './locations';

export type DocumentChunkKind =
  | 'text'
  | 'paragraph'
  | 'table'
  | 'sheet-range'
  | 'slide'
  | 'page'
  | 'image-text';

export interface DocumentChunk {
  documentId: string;
  chunkId: string;

  kind: DocumentChunkKind;

  /** Plain-text content, when the chunk has one. */
  text?: string;

  /** Structured representation (rows, cells, nodes), format-specific. */
  structured?: unknown;

  location: DocumentLocation;

  /** Privacy classification inherited from the source. */
  classification: DataClassification;

  /** Cursor to fetch the next chunk, when the read was truncated. */
  nextCursor?: string;
}
