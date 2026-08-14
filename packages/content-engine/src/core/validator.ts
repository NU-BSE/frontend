import type { DocumentPatch } from '../contracts/operations';
import type { DocumentRef } from '../contracts/document-ref';

export interface ValidationIssue {
  code: string;
  message: string;
  location?: Readonly<Record<string, unknown>>;
}

export interface ValidationResult {
  valid: boolean;
  issues: readonly ValidationIssue[];
}

export interface DocumentValidator {
  validatePatch(document: DocumentRef, patch: DocumentPatch): Promise<ValidationResult>;
  validatePersisted(document: DocumentRef): Promise<ValidationResult>;
}
