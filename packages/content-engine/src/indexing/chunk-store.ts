/**
 * Local chunk storage contract.
 *
 * Backed by app-private storage (expo-sqlite) in a future implementation, so
 * large documents do not have to be re-parsed for every operation. Chunk
 * content is private data and must not be logged or sent off-device.
 */
import type { DocumentChunk } from '../contracts/chunks';

export interface ChunkPage {
  chunks: readonly DocumentChunk[];
  cursor?: string;
}

export interface DocumentChunkStore {
  put(documentId: string, chunk: DocumentChunk): Promise<void>;

  get(chunkId: string): Promise<DocumentChunk | undefined>;

  list(documentId: string, cursor?: string): Promise<ChunkPage>;

  remove(documentId: string): Promise<void>;
}
