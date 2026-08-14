/**
 * The execution router: decides *where* a document operation runs.
 *
 * The router only plans — it never executes. A concrete router later
 * implements the local-first ordering documented in the README:
 *
 *   1. cloud-native document → native-api
 *   2. reasonably local → local
 *   3. OCR / conversion / heavy → remote
 *   4. local failed on a resource constraint → remote, only if policy allows
 *
 * Routing is per-operation, never per-document: the same `DocumentRef` can be
 * inspected locally and OCR'd remotely within one conversation.
 */
import type { ProcessingContext } from './processing-context';
import type { ExecutionPlan } from './execution-plan';

export interface ExecutionRouter {
  plan(context: ProcessingContext): Promise<ExecutionPlan>;
}
