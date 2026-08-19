/**
 * Execution-layer errors. Local-only semantics are enforced here: when neither
 * the JS nor the native processor can handle an operation, the engine surfaces
 * `LOCAL_PROCESSING_UNSUPPORTED` — it never invents a cloud fallback.
 *
 * `DocumentError` itself lives in `contracts/errors` and is re-exported through
 * the package index; this module only provides typed factories.
 */
import { DocumentError } from '../contracts/errors';

/** Signals that no on-device processor can handle the operation. */
export function localProcessingUnsupported(
  detail: string,
  cause?: unknown,
): DocumentError {
  return new DocumentError('LOCAL_PROCESSING_UNSUPPORTED', detail, cause);
}

/** Signals that a requested operation exceeds the device's memory budget. */
export function memoryLimit(detail: string, cause?: unknown): DocumentError {
  return new DocumentError('MEMORY_LIMIT', detail, cause);
}
