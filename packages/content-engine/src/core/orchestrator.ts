import type { DocumentEngine } from '../contracts/engine';
import type { DocumentRef } from '../contracts/document-ref';

/**
 * Coordination boundary for resolve -> inspect/read/edit -> validate -> persist.
 * This PR intentionally provides no implementation.
 */
export interface DocumentOrchestrator extends DocumentEngine {
  resolve(document: DocumentRef): Promise<DocumentRef>;
}
