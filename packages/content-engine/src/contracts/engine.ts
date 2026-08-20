import type { DocumentRef, DocumentFormat } from './document-ref';
import type { DocumentPatch } from './patches';
import type { DocumentSelector } from './selectors';
import type {
  DocumentExtractionResult,
  DocumentInspection,
  DocumentMutationResult,
  DocumentReadResult,
  DocumentSearchResult,
} from './results';

export interface DocumentCreateRequest {
  name: string;
  format: DocumentFormat;
  source?: DocumentRef['source'];
  content?: unknown;
}

export interface DocumentEngine {
  inspect(document: DocumentRef): Promise<DocumentInspection>;
  read(
    document: DocumentRef,
    selector?: DocumentSelector,
  ): Promise<DocumentReadResult>;
  search(document: DocumentRef, query: string): Promise<DocumentSearchResult>;
  extract<T = unknown>(
    document: DocumentRef,
    schema: unknown,
    selector?: DocumentSelector,
  ): Promise<DocumentExtractionResult<T>>;
  create(request: DocumentCreateRequest): Promise<DocumentRef>;
  update(
    document: DocumentRef,
    patch: DocumentPatch,
  ): Promise<DocumentMutationResult>;
  convert(document: DocumentRef, format: DocumentFormat): Promise<DocumentRef>;
  save(document: DocumentRef): Promise<DocumentRef>;
}
