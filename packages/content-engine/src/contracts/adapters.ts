import type { ContentSource, DocumentFormat, DocumentRef } from './document-ref';
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
  fetch(ref: DocumentRef): Promise<unknown>;
  persist?(ref: DocumentRef, payload: unknown): Promise<DocumentRef>;
}

export interface DocumentFormatAdapter {
  readonly id: string;
  readonly formats: readonly DocumentFormat[];

  capabilities(ref: DocumentRef): Promise<DocumentCapabilities>;
  inspect(ref: DocumentRef, payload: unknown): Promise<DocumentInspection>;
  read(
    ref: DocumentRef,
    payload: unknown,
    selector?: DocumentSelector,
  ): Promise<DocumentContentChunk>;
  search?(
    ref: DocumentRef,
    payload: unknown,
    query: string,
  ): Promise<DocumentSearchResult>;
  applyPatch?(
    ref: DocumentRef,
    payload: unknown,
    patch: DocumentPatch,
  ): Promise<DocumentMutationResult>;
}
