import type { DocumentCapabilities } from './capabilities';
import type { DocumentNode } from './nodes';
import type { DocumentRef } from './document-ref';

export interface DocumentLocation {
  sheet?: string;
  range?: string;
  cell?: string;
  page?: number;
  paragraphId?: string;
  heading?: string;
  slide?: number;
  shapeId?: string;
  bbox?: readonly number[];
}

export interface DocumentInspection {
  document: DocumentRef;
  capabilities: DocumentCapabilities;
  structure: Readonly<Record<string, unknown>>;
}

export interface DocumentContentChunk {
  document: DocumentRef;
  nodes: readonly DocumentNode[];
  location?: DocumentLocation;
  truncated: boolean;
  cursor?: string;
  remaining?: number;
}

export interface DocumentSearchHit {
  location: DocumentLocation;
  text: string;
  score?: number;
}

export interface DocumentSearchResult {
  document: DocumentRef;
  hits: readonly DocumentSearchHit[];
  cursor?: string;
}

export interface DocumentExtractionResult<T = unknown> {
  document: DocumentRef;
  value: T;
  locations?: readonly DocumentLocation[];
}

export interface DocumentMutationResult {
  document: DocumentRef;
  previousRevision?: string;
  revision?: string;
  validated: boolean;
}
