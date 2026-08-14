import type {
  BinaryDocument,
  ContentSource,
  DocumentFormat,
  DocumentRef,
} from './document-ref';
import type { DocumentCapabilities } from './capabilities';
import type { DocumentPatch } from './operations';
import type { DocumentSelector } from './selectors';
import type {
  DocumentContentChunk,
  DocumentInspection,
  DocumentMutationResult,
  DocumentSearchResult,
} from './results';

export interface DocumentSourceAdapter {
  readonly id: string;
  readonly sources: readonly ContentSource[];

  resolve(ref: DocumentRef): Promise<DocumentRef>;
  fetch(ref: DocumentRef): Promise<BinaryDocument>;
  persist?(ref: DocumentRef, payload: BinaryDocument): Promise<DocumentRef>;
}

export interface DocumentFormatAdapter {
  readonly id: string;
  readonly formats: readonly DocumentFormat[];

  capabilities(ref: DocumentRef): Promise<DocumentCapabilities>;
  inspect(ref: DocumentRef, payload: BinaryDocument): Promise<DocumentInspection>;
  read(
    ref: DocumentRef,
    payload: BinaryDocument,
    selector?: DocumentSelector,
  ): Promise<DocumentContentChunk>;
  search?(
    ref: DocumentRef,
    payload: BinaryDocument,
    query: string,
  ): Promise<DocumentSearchResult>;
  applyPatch?(
    ref: DocumentRef,
    payload: BinaryDocument,
    patch: DocumentPatch,
  ): Promise<DocumentMutationResult>;
}
