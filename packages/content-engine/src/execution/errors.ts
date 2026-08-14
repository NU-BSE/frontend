/**
 * Structured processing errors.
 *
 * The routing/processing layer reports failures through codes, never through
 * string-matching on exception messages. `cannot_process_locally` is the
 * contract a `local-only` policy surfaces instead of silently uploading a
 * document to a backend.
 */

export type ProcessingErrorCode =
  | 'cannot_process_locally'
  | 'remote_processing_disabled'
  | 'unsupported_operation'
  | 'unsupported_format'
  | 'processor_unavailable'
  | 'native_api_unavailable'
  | 'resource_limit'
  | 'requires_ocr'
  | 'requires_conversion';

export class ProcessingError extends Error {
  constructor(
    readonly code: ProcessingErrorCode,
    message: string,
    readonly cause?: unknown,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ProcessingError';
  }
}
