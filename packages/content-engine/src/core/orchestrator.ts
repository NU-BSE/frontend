import type { DocumentEngine } from '../contracts/engine';
import type { DocumentRef } from '../contracts/document-ref';
import type { DocumentComplexityInspector } from '../execution/document-complexity';
import type { LocalExecutionRouter } from '../execution/local-execution-router';
import type { ProcessorRegistry } from '../execution/processor-registry';
import type { DocumentIndex } from '../indexing/document-index';

/**
 * Coordination boundary for the full document pipeline:
 *
 *   resolve
 *     ↓
 *   inspect / determine complexity
 *     ↓
 *   build LocalProcessingContext
 *     ↓
 *   LocalExecutionRouter.plan()          (js | native — never remote)
 *     ↓
 *   processor → source adapter → format adapter
 *     ↓
 *   chunk → local index → local model
 *     ↓
 *   DocumentPatch → format adapter → validate → persist
 *
 * The execution/indexing boundaries are optional slots here: a concrete
 * orchestrator wires them, while this interface documents where they sit. No
 * algorithm is implemented in this scaffold.
 */
export interface DocumentOrchestrator extends DocumentEngine {
  resolve(document: DocumentRef): Promise<DocumentRef>;

  /** Decides the on-device execution target for each operation. */
  executionRouter?: LocalExecutionRouter;

  /** Resolves a planned target to a concrete on-device processor. */
  processorRegistry?: ProcessorRegistry;

  /** Fills in `DocumentComplexity` before routing. */
  complexityInspector?: DocumentComplexityInspector;

  /** Local chunk store + FTS index for progressive/retrieval processing. */
  documentIndex?: DocumentIndex;
}
