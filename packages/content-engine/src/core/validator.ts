import type { DocumentPatch } from '../contracts/patches';
import type { DocumentRef } from '../contracts/document-ref';
import type { DocumentValidationResult } from '../contracts/results';

/**
 * Every adapter must be able to validate its own output: re-open the produced
 * binary, verify the expected mutation is present, and confirm the original
 * critical parts remain. An edit is never persisted before validation passes.
 */
export interface DocumentValidator {
  validatePatch(
    document: DocumentRef,
    patch: DocumentPatch,
  ): Promise<DocumentValidationResult>;
  validatePersisted(document: DocumentRef): Promise<DocumentValidationResult>;
}
