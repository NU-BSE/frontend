import type { DocumentEngine } from '../contracts/engine';
import type { DocumentRef } from '../contracts/document-ref';
import type { DocumentComplexityInspector } from '../execution/document-complexity';
import type { ExecutionRouter } from '../execution/execution-router';
import type { ProcessorRegistry } from '../execution/processor-registry';

/**
 * Coordination boundary for the full document pipeline:
 *
 *   resolve
 *     ↓
 *   inspect / determine complexity
 *     ↓
 *   build ProcessingContext
 *     ↓
 *   ExecutionRouter.plan()
 *     ↓
 *   processor (local | native-api | remote)
 *     ↓
 *   adapter (source + format)
 *     ↓
 *   validate
 *     ↓
 *   persist
 *
 * The execution boundaries are optional slots here: a concrete orchestrator
 * wires them, while this interface documents where they sit. No algorithm is
 * implemented in this scaffold.
 */
export interface DocumentOrchestrator extends DocumentEngine {
  resolve(document: DocumentRef): Promise<DocumentRef>;

  /** Decides the execution target for each operation. */
  executionRouter?: ExecutionRouter;

  /** Resolves a planned target to a concrete processor. */
  processorRegistry?: ProcessorRegistry;

  /** Fills in `DocumentComplexity` before routing. */
  complexityInspector?: DocumentComplexityInspector;
}
