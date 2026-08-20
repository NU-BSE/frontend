import type { DataClassification } from '../../../privacy/data-classification';
import type { DocumentChunk, DocumentChunkKind } from '../../../contracts/chunks';
import type { DocumentLocation } from '../../../contracts/locations';
import type { DocumentReadResult } from '../../../contracts/results';
import type { DocumentRef } from '../../../contracts/document-ref';

/**
 * Turning a linear sequence of pieces into bounded, resumable chunks.
 *
 * Every text-ish adapter has the same job once it has parsed its input: hand
 * back as much as fits, say whether more remains, and give a cursor that
 * resumes exactly where it stopped. Doing that once here keeps the cursor
 * format identical across formats, which matters because the cursor is opaque
 * to the caller and a per-adapter dialect would be impossible to debug.
 */

/** One parsed unit before it is grouped into a chunk. */
export interface TextPiece {
  text: string;
  location: DocumentLocation;
  /** Overrides the reader's default kind for this piece. */
  kind?: DocumentChunkKind;
  structured?: unknown;
}

export interface ChunkLimits {
  /** Characters per chunk. Pieces are never split below this. */
  maxCharsPerChunk: number;
  /** Chunks returned by a single read. */
  maxChunksPerRead: number;
}

export const DEFAULT_CHUNK_LIMITS: ChunkLimits = {
  /*
   * Sized for the on-device model's context rather than for the file: a chunk
   * is what gets handed to the model, so a larger one is not a cheaper read,
   * it is a read the model cannot use.
   */
  maxCharsPerChunk: 4000,
  maxChunksPerRead: 24,
};

const CURSOR_PREFIX = 'piece:';

/** Cursors are an index into the piece list, not a byte offset. */
export function encodePieceCursor(index: number): string {
  return `${CURSOR_PREFIX}${index}`;
}

export function decodePieceCursor(cursor: string): number | null {
  if (!cursor.startsWith(CURSOR_PREFIX)) return null;
  const index = Number.parseInt(cursor.slice(CURSOR_PREFIX.length), 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * Groups consecutive pieces into chunks, starting at `startIndex`.
 *
 * A piece longer than the char budget becomes its own oversized chunk rather
 * than being cut: pieces are semantic units (a paragraph, a row, a slide) and
 * splitting one mid-sentence would break the location that makes a later
 * targeted edit possible. The budget is therefore a target, not a hard cap.
 */
export function chunkPieces(
  document: DocumentRef,
  pieces: readonly TextPiece[],
  classification: DataClassification,
  defaultKind: DocumentChunkKind,
  limits: ChunkLimits = DEFAULT_CHUNK_LIMITS,
  startIndex = 0,
): DocumentReadResult {
  const chunks: DocumentChunk[] = [];
  let index = Math.max(0, startIndex);

  while (index < pieces.length && chunks.length < limits.maxChunksPerRead) {
    const first = pieces[index]!;
    const parts: string[] = [first.text];
    const location = first.location;
    const kind = first.kind ?? defaultKind;
    let size = first.text.length;
    const startedAt = index;
    index += 1;

    // A piece carrying structured data stands alone: merging would leave the
    // chunk's `structured` describing only part of its text.
    if (first.structured === undefined) {
      while (index < pieces.length) {
        const next = pieces[index]!;
        if (next.structured !== undefined) break;
        if ((next.kind ?? defaultKind) !== kind) break;
        /*
         * A heading opens a section, so it must open a chunk. Merging it into
         * the chunk before it would leave that chunk's location naming the
         * previous heading, and the new heading would vanish from the result
         * entirely — the outline would collapse to whichever heading happened
         * to come first.
         */
        if (next.location.heading !== undefined) break;
        if (size + next.text.length > limits.maxCharsPerChunk) break;
        parts.push(next.text);
        size += next.text.length;
        index += 1;
      }
    }

    chunks.push({
      documentId: document.id,
      chunkId: `${kind}-${startedAt}`,
      kind,
      text: parts.join('\n'),
      ...(first.structured !== undefined ? { structured: first.structured } : {}),
      location,
      classification,
    });
  }

  const truncated = index < pieces.length;
  if (truncated && chunks.length > 0) {
    // The cursor rides on the last chunk as well as the result, so a caller
    // that keeps only the chunks can still resume.
    chunks[chunks.length - 1] = {
      ...chunks[chunks.length - 1]!,
      nextCursor: encodePieceCursor(index),
    };
  }

  return {
    document,
    chunks,
    truncated,
    ...(truncated ? { cursor: encodePieceCursor(index), remaining: pieces.length - index } : {}),
  };
}
