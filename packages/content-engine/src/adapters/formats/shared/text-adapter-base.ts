import type { BinaryDocument } from '../../../contracts/binary-document';
import type { DocumentCapabilities } from '../../../contracts/capabilities';
import type { DocumentChunkKind } from '../../../contracts/chunks';
import type { DocumentRef } from '../../../contracts/document-ref';
import type { DocumentSelector } from '../../../contracts/selectors';
import type {
  DocumentInspection,
  DocumentReadResult,
  DocumentSearchHit,
  DocumentSearchResult,
} from '../../../contracts/results';
import type { DocumentFormatAdapter } from '../../../contracts/adapters';
import { classifyDocument } from '../../../privacy/data-classification';

import {
  DEFAULT_CHUNK_LIMITS,
  chunkPieces,
  decodePieceCursor,
  type ChunkLimits,
  type TextPiece,
} from './chunking';

/**
 * The shared body of every text-derived adapter.
 *
 * Once a format has been reduced to an ordered list of `TextPiece`, reading,
 * cursoring and searching are identical whether the pieces came from Markdown
 * headings, CSV rows or DOCX paragraphs. Subclasses supply the parse step and
 * their own structural summary; everything below is format-independent.
 *
 * Parsing happens per call rather than being cached. That is deliberate: these
 * adapters are handed a `BinaryDocument` by the caller and hold no ownership
 * of it, and caching parsed state keyed by document id is how a stale read
 * survives an edit. The engine's chunk cache is the right place for reuse.
 */
export abstract class TextDerivedAdapter implements DocumentFormatAdapter {
  abstract readonly id: string;

  /** Chunk kind used when a piece does not name its own. */
  protected readonly defaultKind: DocumentChunkKind = 'text';

  protected readonly limits: ChunkLimits;

  constructor(limits: Partial<ChunkLimits> = {}) {
    this.limits = { ...DEFAULT_CHUNK_LIMITS, ...limits };
  }

  abstract detect(input: BinaryDocument): Promise<boolean>;

  /** Reduce the raw bytes to an ordered list of semantic pieces. */
  protected abstract parse(input: BinaryDocument): readonly TextPiece[];

  /** Format-specific summary for `inspect`. */
  protected abstract summarize(
    pieces: readonly TextPiece[],
    input: BinaryDocument,
  ): Readonly<Record<string, unknown>>;

  async capabilities(_document: DocumentRef): Promise<DocumentCapabilities> {
    return {
      inspect: true,
      read: true,
      search: true,
      extract: true,
      create: false,
      update: false,
      // Nothing here rewrites its source, so claiming otherwise would be a
      // promise the router relies on and this adapter cannot keep.
      preservesFormattingOnUpdate: false,
      tables: false,
      images: false,
      formulas: false,
      sheets: false,
      slides: false,
      // Every piece carries a location, so a caller can ask for a heading or a
      // paragraph rather than the whole file, and resume through a cursor.
      targetedRead: true,
      streamingRead: true,
      localIndexing: true,
    };
  }

  async inspect(
    document: DocumentRef,
    input: BinaryDocument,
  ): Promise<DocumentInspection> {
    const pieces = this.parse(input);
    return {
      document,
      capabilities: await this.capabilities(document),
      structure: {
        pieces: pieces.length,
        characters: pieces.reduce((total, piece) => total + piece.text.length, 0),
        ...this.summarize(pieces, input),
      },
    };
  }

  async read(
    document: DocumentRef,
    input: BinaryDocument,
    selector: DocumentSelector,
  ): Promise<DocumentReadResult> {
    const pieces = this.parse(input);
    const classification = classifyDocument(document);
    const selected = this.select(pieces, selector);
    const start =
      selector.kind === 'cursor' ? (decodePieceCursor(selector.cursor) ?? 0) : 0;

    return chunkPieces(
      document,
      selected,
      classification,
      this.defaultKind,
      this.limits,
      start,
    );
  }

  /**
   * Narrows the piece list for selectors a text format can honour.
   *
   * `heading` keeps the matching section and everything under it until the
   * next heading at the same or shallower depth, which is what a reader means
   * by "that section". Selectors belonging to other shapes (spreadsheet
   * ranges, slides) fall through to the whole document rather than returning
   * nothing: an empty read looks like an empty file.
   */
  protected select(
    pieces: readonly TextPiece[],
    selector: DocumentSelector,
  ): readonly TextPiece[] {
    if (selector.kind === 'heading') {
      const wanted = selector.heading.trim().toLowerCase();
      const startIndex = pieces.findIndex(
        (piece) => piece.location.heading?.trim().toLowerCase() === wanted,
      );
      if (startIndex === -1) return [];
      const depth = pieces[startIndex]!.location.headingPath?.length ?? 0;
      let end = pieces.length;
      for (let i = startIndex + 1; i < pieces.length; i += 1) {
        const piece = pieces[i]!;
        const isHeading = piece.location.heading !== undefined;
        const pieceDepth = piece.location.headingPath?.length ?? 0;
        if (isHeading && pieceDepth <= depth) {
          end = i;
          break;
        }
      }
      return pieces.slice(startIndex, end);
    }

    if (selector.kind === 'paragraph') {
      const found = pieces.filter(
        (piece) => piece.location.paragraphId === selector.paragraphId,
      );
      return found;
    }

    if (selector.kind === 'pages') {
      const wanted = new Set(selector.pages);
      const found = pieces.filter(
        (piece) => piece.location.page !== undefined && wanted.has(piece.location.page),
      );
      if (found.length > 0) return found;
    }

    return pieces;
  }

  async search(
    document: DocumentRef,
    input: BinaryDocument,
    query: string,
    cursor?: string,
  ): Promise<DocumentSearchResult> {
    const pieces = this.parse(input);
    const needle = query.trim().toLowerCase();
    if (!needle) return { document, hits: [] };

    const start = cursor ? (decodePieceCursor(cursor) ?? 0) : 0;
    const hits: DocumentSearchHit[] = [];
    let index = start;

    for (; index < pieces.length; index += 1) {
      if (hits.length >= this.limits.maxChunksPerRead) break;
      const piece = pieces[index]!;
      // Case-insensitive on both sides so non-ASCII scripts match the way a
      // reader expects; localeCompare-style folding is not available here.
      const at = piece.text.toLowerCase().indexOf(needle);
      if (at === -1) continue;
      hits.push({
        location: piece.location,
        text: excerpt(piece.text, at, needle.length),
      });
    }

    return {
      document,
      hits,
      ...(index < pieces.length ? { cursor: `piece:${index}` } : {}),
    };
  }
}

/** A window of text around a hit, with ellipses only where text was removed. */
function excerpt(text: string, at: number, length: number, radius = 80): string {
  const from = Math.max(0, at - radius);
  const to = Math.min(text.length, at + length + radius);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}
