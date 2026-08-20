import type { DocumentRef } from '../contracts/document-ref';

export interface DocumentVersion {
  revision: string;
  createdAt: number;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface DocumentVersionStore {
  list(document: DocumentRef): Promise<readonly DocumentVersion[]>;
  snapshot(document: DocumentRef): Promise<DocumentVersion>;
  restore(document: DocumentRef, revision: string): Promise<DocumentRef>;
}
