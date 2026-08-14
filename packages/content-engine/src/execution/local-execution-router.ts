/**
 * Local execution routing: decide *which on-device engine* runs an operation.
 *
 * The router only plans — it never executes. It chooses between the JS
 * processor and the native processor; if neither can handle the operation, the
 * result is a `LOCAL_PROCESSING_UNSUPPORTED` error, never a cloud fallback.
 */
import type { LocalProcessingContext } from './processing-context';
import type { LocalExecutionTarget } from './execution-target';

export type LocalExecutionReason =
  | 'lightweight-structured-format'
  | 'native-format-support'
  | 'memory-risk'
  | 'requires-ocr'
  | 'requires-native-pdf'
  | 'large-archive'
  | 'unsupported-in-js';

/** How much of the document the operation should touch. */
export type LocalExecutionStrategy =
  | 'full'
  | 'targeted'
  | 'streaming'
  | 'indexed';

export interface LocalExecutionPlan {
  target: LocalExecutionTarget;
  reason: LocalExecutionReason;
  strategy?: LocalExecutionStrategy;
}

export interface LocalExecutionRouter {
  plan(context: LocalProcessingContext): Promise<LocalExecutionPlan>;
}
