import type { DocumentRef } from '../contracts/document-ref';

export interface DocumentSession {
  id: string;
  document: DocumentRef;
  openedAt: number;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface DocumentSessionManager {
  open(document: DocumentRef): Promise<DocumentSession>;
  get(sessionId: string): Promise<DocumentSession | undefined>;
  close(sessionId: string): Promise<void>;
}
