/**
 * The structured outcome of routing. A bare `"local"` string is not enough:
 * the plan must be diagnosable (why this target) and explicit about whether a
 * fallback is allowed.
 */
import type { ProcessingTarget } from './types';

export type ExecutionPlanReason =
  | 'cloud_native_document'
  | 'local_preferred'
  | 'local_supported'
  | 'remote_required'
  | 'requires_ocr'
  | 'requires_conversion'
  | 'document_too_complex'
  | 'device_constraint'
  | 'policy_constraint'
  | 'unsupported_locally';

export interface ExecutionPlan {
  target: ProcessingTarget;

  reason: ExecutionPlanReason;

  /**
   * Where to retry if the primary target cannot complete the operation. Only
   * meaningful when `allowFallback` is true.
   */
  fallback?: ProcessingTarget;

  /**
   * False when the router has decided this operation must not move elsewhere
   * (e.g. `local-only` policy, or the document must use its native API).
   */
  allowFallback: boolean;

  metadata?: Readonly<Record<string, unknown>>;
}
