import type {
  AgentToolCall,
  AgentToolResult,
} from '../types';
import type { ToolCallFingerprint } from './types';
import { ROUTING_CONFIG } from './config';

/**
 * Canonical hash of a tool call's arguments — keyed and ordered so the same
 * payload always hashes to the same fingerprint regardless of JSON key order.
 */
function normalizeArgs(args: Record<string, unknown>): string {
  const sorted = Object.keys(args)
    .filter((key) => key !== 'approvalId')
    .sort();
  const pairs: string[] = [];
  for (const key of sorted) {
    pairs.push(`${key}:${JSON.stringify(args[key])}`);
  }
  return pairs.join('|');
}

/**
 * Detects repeated planner behaviour without modelling the planner itself.
 *
 * Two patterns are caught:
 * - one call repeated N times with the same tool + same normalised arguments;
 * - a 2-call sequence (A, B, A, B) repeating at least twice.
 *
 * Legitimate bulk actions with different targets (search for Aidar, search
 * for Daniyar — different arguments) do not count.
 */
export class LoopDetector {
  private readonly fingerprints: ToolCallFingerprint[] = [];

  /**
   * Call after every tool call. The detector maintains a sliding window of
   * recent fingerprints.
   */
  record(call: AgentToolCall, _result: AgentToolResult): void {
    this.fingerprints.push({
      toolName: call.toolName,
      normalizedArgsHash: normalizeArgs(call.args),
    });

    if (this.fingerprints.length > 20) {
      this.fingerprints.shift();
    }
  }

  /**
   * Returns true when the same call repeats more than the configured limit
   * or when any 2-call sequence repeats more than once.
   */
  isRepeating(): boolean {
    if (this.fingerprints.length < ROUTING_CONFIG.loopSameCallCount) {
      return false;
    }

    // Detect single-call repetition.
    const recent = this.fingerprints.slice(
      -ROUTING_CONFIG.loopSameCallCount,
    );
    if (allEqual(recent)) return true;

    // Detect 2-call sequence repetition (A, B, A, B).
    if (this.fingerprints.length >= 4) {
      const last4 = this.fingerprints.slice(-4);
      const seq0 = fingerprintKey(last4[0]);
      const seq1 = fingerprintKey(last4[1]);
      const seq2 = fingerprintKey(last4[2]);
      const seq3 = fingerprintKey(last4[3]);

      if (seq0 === seq2 && seq1 === seq3 && seq0 !== seq1) {
        return true;
      }
    }

    return false;
  }

  /** Reset for a new run. */
  reset(): void {
    this.fingerprints.length = 0;
  }
}

function fingerprintKey(fingerprint: ToolCallFingerprint): string {
  return `${fingerprint.toolName}::${fingerprint.normalizedArgsHash}`;
}

function allEqual(fingerprints: ToolCallFingerprint[]): boolean {
  if (fingerprints.length <= 1) return false;
  const first = fingerprintKey(fingerprints[0]);
  return fingerprints.every((fp) => fingerprintKey(fp) === first);
}
