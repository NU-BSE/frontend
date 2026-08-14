/**
 * Registry of on-device processors, keyed by target.
 *
 * Lets the orchestrator resolve `LocalExecutionPlan.target` to a processor
 * without knowing concrete implementations — so a future Hermes JS processor
 * or native PDF/OCR module can be plugged in without touching `DocumentEngine`.
 */
import type { LocalExecutionTarget } from './execution-target';
import type { LocalDocumentProcessor } from './processor';

export interface ProcessorRegistry {
  get(target: LocalExecutionTarget): LocalDocumentProcessor | undefined;

  readonly processors: readonly LocalDocumentProcessor[];
}
