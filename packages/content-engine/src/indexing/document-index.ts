/**
 * The local document index facade: chunk storage + full-text search, plus a
 * place for future revision/cache metadata. This is how a large document is
 * searched without re-parsing it, and how the local model receives only the
 * relevant chunks.
 */
import type { DocumentChunkStore } from './chunk-store';
import type { FtsIndex } from './fts-index';

export interface DocumentIndex {
  readonly chunks: DocumentChunkStore;
  readonly fts: FtsIndex;
}
