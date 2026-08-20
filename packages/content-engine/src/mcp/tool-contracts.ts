import type { DocumentFormat, DocumentRef } from '../contracts/document-ref';
import type { DocumentPatch } from '../contracts/patches';
import type { DocumentSelector } from '../contracts/selectors';

export interface DocumentFindInput {
  query: string;
  source?: DocumentRef['source'];
}

export interface DocumentInspectInput {
  document: DocumentRef;
}

export interface DocumentReadInput {
  document: DocumentRef;
  selector?: DocumentSelector;
}

export interface DocumentSearchInput {
  document: DocumentRef;
  query: string;
}

export interface DocumentExtractInput {
  document: DocumentRef;
  schema: unknown;
  selector?: DocumentSelector;
}

export interface DocumentCreateInput {
  name: string;
  format: DocumentFormat;
  source?: DocumentRef['source'];
  content?: unknown;
}

export interface DocumentUpdateInput {
  document: DocumentRef;
  patch: DocumentPatch;
}

export interface DocumentConvertInput {
  document: DocumentRef;
  format: DocumentFormat;
}

export interface DocumentSaveInput {
  document: DocumentRef;
}
