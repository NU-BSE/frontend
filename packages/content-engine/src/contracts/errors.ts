/**
 * Machine-readable document errors.
 *
 * The LLM must be able to reason about failures from a code, never from
 * string-matching a human message. Codes like `LOCAL_PROCESSING_UNSUPPORTED`
 * tell the agent to change strategy (targeted read, smaller scope) rather than
 * retry or guess.
 */
export type DocumentErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'FORMAT_MISMATCH'
  | 'CORRUPT_DOCUMENT'
  | 'DOCUMENT_PASSWORD_REQUIRED'
  | 'ENCRYPTED_DOCUMENT_UNSUPPORTED'
  | 'LOCAL_PROCESSING_UNSUPPORTED'
  | 'MEMORY_LIMIT'
  | 'INVALID_SELECTOR'
  | 'LOCATION_NOT_FOUND'
  | 'PATCH_CONFLICT'
  | 'REVISION_CONFLICT'
  | 'VALIDATION_FAILED'
  | 'SOURCE_READ_FAILED'
  | 'SOURCE_WRITE_FAILED'
  | 'NATIVE_PROCESSOR_UNAVAILABLE'
  | 'UNSUPPORTED_OPERATION';

export class DocumentError extends Error {
  constructor(
    readonly code: DocumentErrorCode,
    message: string,
    readonly cause?: unknown,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'DocumentError';
  }
}
