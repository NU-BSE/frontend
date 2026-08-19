import type { DocumentCapabilities } from '../contracts/capabilities';
import type { DocumentRef } from '../contracts/document-ref';

export interface CapabilityRegistry {
  resolve(document: DocumentRef): Promise<DocumentCapabilities>;
}
