import type { DocumentCapabilities } from './capabilities';
import type { DocumentChunk } from './chunks';
import type { DocumentRef } from './document-ref';
import type { DocumentLocation } from './locations';

export interface DocumentInspection {
  document: DocumentRef;
  capabilities: DocumentCapabilities;
  /** Format-specific structural summary (sheet names, headings, slide titles). */
  structure: Readonly<Record<string, unknown>>;
}

/** A bounded read result; `truncated`/`cursor` drive chunked processing. */
export interface DocumentReadResult {
  document: DocumentRef;
  chunks: readonly DocumentChunk[];
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

export interface DocumentValidationIssue {
  code: string;
  message: string;
  location?: DocumentLocation;
}

export interface DocumentValidationResult {
  valid: boolean;
  issues: readonly DocumentValidationIssue[];
}
