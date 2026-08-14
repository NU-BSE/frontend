/**
 * User-controlled execution policy.
 *
 * The policy is the single place where the user asserts how their document
 * may be processed. It is a hard gate for the router: a `local-only` document
 * must never be silently uploaded to a backend, no matter how "convenient"
 * the fallback would be.
 */

/**
 * High-level execution preference:
 * - `auto`          — let the router choose local first, fall back within policy.
 * - `local-only`    — never leave the device; failures are surfaced, not masked.
 * - `allow-remote`  — remote processing is explicitly permitted.
 */
export type ExecutionPreference = 'auto' | 'local-only' | 'allow-remote';

export interface ProcessingPolicy {
  execution: ExecutionPreference;

  /** Prefer local processing whenever it is reasonably possible. */
  preferLocal: boolean;

  /** Remote processing is prohibited when false. */
  allowRemote: boolean;

  /** Document may contain sensitive/private data. */
  sensitive?: boolean;

  /** Preserve as much native document formatting/structure as possible. */
  preserveFormatting?: boolean;

  /**
   * Optional local resource limit: documents larger than this (in bytes)
   * should not be fully loaded into local memory.
   */
  maxLocalBytes?: number;
}
