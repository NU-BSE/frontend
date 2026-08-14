/**
 * Base processor contract shared by every execution target.
 *
 * A processor is the seam where a target actually performs operations. The
 * base only declares which target it serves and whether it can handle a given
 * context; concrete execution signatures are added per target later.
 */
import type { ProcessingContext } from '../processing-context';
import type { ProcessingTarget } from '../types';

export interface DocumentProcessor {
  readonly target: ProcessingTarget;

  /** Whether this processor can handle the given operation/context. */
  supports(context: ProcessingContext): Promise<boolean>;
}
