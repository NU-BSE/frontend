/**
 * Local full-text search contract (SQLite FTS5 in a future implementation).
 *
 * Lexical/structured search runs on the device without the LLM and without
 * any cloud service. Semantic/vector retrieval is intentionally out of scope
 * until lexical retrieval works.
 */
import type { DocumentChunk } from '../contracts/chunks';
import type { DocumentSearchHit } from '../contracts/results';

export interface FtsSearchOptions {
  limit?: number;
  /** Restrict the search to a single document. */
  documentId?: string;
}

export interface FtsIndex {
  index(documentId: string, chunks: readonly DocumentChunk[]): Promise<void>;

  search(query: string, options?: FtsSearchOptions): Promise<DocumentSearchHit[]>;

  remove(documentId: string): Promise<void>;
}
