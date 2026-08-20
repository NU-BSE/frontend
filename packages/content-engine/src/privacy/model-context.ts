/**
 * The seam between the Content Engine and the AI model router.
 *
 * Document text is parsed locally, but it must still be prevented from
 * reaching a cloud LLM by accident. This module classifies model context and
 * decides which model runtime may receive it.
 *
 *   user-private / sensitive  →  local model only (no cloud fallback)
 *   credential                →  never a prompt, even locally
 *   public                    →  any runtime
 */
import type { DataClassification } from './data-classification';
import type { ContentProvenance } from './context-provenance';

export type ModelRuntime = 'local' | 'cloud';

/** A piece of text intended as model context, tagged with its privacy class. */
export interface ModelContextEnvelope {
  text: string;
  classification: DataClassification;
  provenance: readonly ContentProvenance[];
}

/** Decides which model runtime may receive a given classification. */
export function routeModel(classification: DataClassification): ModelRuntime {
  if (classification === 'user-private' || classification === 'sensitive') {
    return 'local';
  }
  return 'cloud';
}

/**
 * Whether this classification may become prompt context at all. Credentials
 * (OAuth tokens, refresh tokens, API keys, cookies, private keys) must never
 * reach a model, local or cloud.
 */
export function isPromptAllowed(classification: DataClassification): boolean {
  return classification !== 'credential';
}
