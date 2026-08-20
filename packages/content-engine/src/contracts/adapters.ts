import type { BinaryDocument } from './binary-document';
import type { DocumentCapabilities } from './capabilities';
import type { DocumentRef } from './document-ref';
import type { DocumentPatch, PersistOptions } from './patches';
import type { DocumentSelector } from './selectors';
import type {
  DocumentInspection,
  DocumentReadResult,
  DocumentSearchResult,
  DocumentValidationResult,
} from './results';

/**
 * Where a document lives and how to get/put its bytes.
 *
 * A source adapter knows nothing about XLSX or DOCX structure — it only
 * resolves references and reads/writes `BinaryDocument`. It may talk directly
 * to the user's chosen provider (Drive, OneDrive, Telegram, …), but that is
 * transport/storage, never processing.
 */
export interface DocumentSourceAdapter {
  readonly id: string;

  supports(ref: DocumentRef): boolean;

  resolve(ref: DocumentRef): Promise<DocumentRef>;

  readBinary(ref: DocumentRef): Promise<BinaryDocument>;

  writeBinary?(
    ref: DocumentRef,
    binary: BinaryDocument,
    options?: PersistOptions,
  ): Promise<DocumentRef>;
}

/**
 * How a document is structured and how to read/search/edit it.
 *
 * Format detection is explicit (`detect`) so routing never trusts a filename
 * extension alone. Native adapters (Kotlin/Swift) may have a different
 * internal implementation, but their public semantics match this interface.
 */
export interface DocumentFormatAdapter {
  readonly id: string;

  /** Whether this adapter can interpret the given binary input. */
  detect(input: BinaryDocument): Promise<boolean>;

  capabilities(document: DocumentRef): Promise<DocumentCapabilities>;

  inspect(
    document: DocumentRef,
    input: BinaryDocument,
  ): Promise<DocumentInspection>;

  read(
    document: DocumentRef,
    input: BinaryDocument,
    selector: DocumentSelector,
  ): Promise<DocumentReadResult>;

  search?(
    document: DocumentRef,
    input: BinaryDocument,
    query: string,
    cursor?: string,
  ): Promise<DocumentSearchResult>;

  applyPatch?(
    document: DocumentRef,
    input: BinaryDocument,
    patch: DocumentPatch,
  ): Promise<BinaryDocument>;

  validate?(input: BinaryDocument): Promise<DocumentValidationResult>;
}
