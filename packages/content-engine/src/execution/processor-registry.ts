/**
 * Registry of execution processors, keyed by target.
 *
 * Lets the orchestrator resolve `ExecutionPlan.target` to a processor without
 * knowing concrete implementations — so HermesLocalProcessor,
 * BackendDocumentProcessor, GoogleWorkspaceProcessor etc. can be plugged in
 * later without touching `DocumentEngine`.
 */
import type { ProcessingTarget } from './types';
import type { DocumentProcessor } from './processors';

export interface ProcessorRegistry {
  get(target: ProcessingTarget): DocumentProcessor | undefined;

  readonly processors: readonly DocumentProcessor[];
}
