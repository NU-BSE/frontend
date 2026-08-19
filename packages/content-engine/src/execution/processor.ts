/**
 * The base contract for every on-device processor.
 *
 * A processor is the seam where a target actually performs operations. The
 * base only declares which target it serves and whether it can handle a given
 * context; concrete execution signatures are added per target later.
 */
import type { LocalProcessingContext } from './processing-context';
import type { LocalExecutionTarget } from './execution-target';

export interface LocalDocumentProcessor {
  readonly target: LocalExecutionTarget;

  /** Whether this processor can handle the given operation/context. */
  supports(context: LocalProcessingContext): Promise<boolean>;
}
