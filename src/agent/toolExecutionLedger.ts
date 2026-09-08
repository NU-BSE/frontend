import type { AgentToolCall, AgentToolResult } from './types';

export interface ToolExecutionRecord {
  toolCallId: string;
  toolName: string;
  argsHash: string;
  status:
    | 'pending'
    | 'approval_required'
    | 'executed'
    | 'failed'
    | 'cancelled'
    | 'uncertain';
  /**
   * The original successful result, preserved so a deduplicated replay can
   * hand the model the real output (event id, message id, …) instead of a
   * bare `{deduplicated: true}` marker that a dependent step cannot use.
   */
  result?: AgentToolResult;
}

/**
 * Per-run ledger that prevents the same side-effectful action from
 * executing twice.  Tier escalation must never replay an already-completed
 * send, create, or delete — idempotency is checked before every MCP call.
 */
export class ToolExecutionLedger {
  private readonly records = new Map<string, ToolExecutionRecord>();

  /**
   * Returns a previous successful record for an equivalent action, or
   * undefined when the action has not yet succeeded this run.
   *
   * Legitimate bulk actions with different targets / payloads produce
   * different hashes and are never blocked.
   */
  findDuplicate(
    call: AgentToolCall,
  ): ToolExecutionRecord | undefined {
    const hash = normalizeArgsHash(call);
    const record = this.records.get(callKey(call.toolName, hash));
    if (record?.status === 'executed') return record;
    return undefined;
  }

  /**
   * Returns a previous *failure* of this exact call, when repeating it cannot
   * plausibly help.
   *
   * Asked to open Gemini's settings, the planner called
   * `android.settings.open_app` with identical arguments four times, each one
   * failing the same way, then wandered into brightness and auto-rotate and
   * hit the ten-step ceiling with nothing to show. Nothing stopped it: this
   * ledger only ever looked for *successful* duplicates, and the loop detector
   * feeds tier escalation rather than termination — and clears its own
   * fingerprints on this class of error, so the repetition never even
   * registered.
   *
   * The same arguments against the same tool produce the same failure, so the
   * second attempt is not a retry, it is the budget being spent to learn
   * nothing. Different arguments hash differently and are always allowed,
   * which is the recovery the model should be making.
   *
   * `NETWORK_ERROR` and `RATE_LIMITED` are the exceptions, and the only ones:
   * they describe the world at a moment rather than the call, and a second
   * attempt genuinely can succeed.
   */
  findRepeatedFailure(
    call: AgentToolCall,
  ): ToolExecutionRecord | undefined {
    const hash = normalizeArgsHash(call);
    const record = this.records.get(callKey(call.toolName, hash));
    if (record?.status !== 'failed') return undefined;

    const code = record.result?.errorCode;
    if (code === 'NETWORK_ERROR' || code === 'RATE_LIMITED') return undefined;

    return record;
  }

  /**
   * Returns a previous record whose outcome is unknown — the side effect may
   * or may not have happened. The agent must NOT auto-replay it; the user has
   * to decide explicitly.
   */
  findUncertain(
    call: AgentToolCall,
  ): ToolExecutionRecord | undefined {
    const hash = normalizeArgsHash(call);
    const record = this.records.get(callKey(call.toolName, hash));
    if (record?.status === 'uncertain') return record;
    return undefined;
  }

  /**
   * Records a new or in-progress execution. Callers should first check
   * `findDuplicate` before executing a side-effectful call.
   */
  record(
    call: AgentToolCall,
    result: AgentToolResult,
  ): void {
    const hash = normalizeArgsHash(call);

    let status: ToolExecutionRecord['status'];
    if (result.status === 'success') {
      status = 'executed';
    } else if (result.status === 'approval_required') {
      status = 'approval_required';
    } else if (result.status === 'user_denied') {
      status = 'cancelled';
    } else if (result.status === 'outcome_unknown') {
      status = 'uncertain';
    } else {
      status = 'failed';
    }

    this.records.set(callKey(call.toolName, hash), {
      toolCallId: call.id,
      toolName: call.toolName,
      argsHash: hash,
      status,
      // Kept for failures as well as successes: `findRepeatedFailure` needs
      // the error code to tell a transient failure from a settled one, and
      // the message to hand back instead of re-running the call.
      ...(result.status === 'success' || result.status === 'error'
        ? { result }
        : {}),
    });
  }

  /** For tests / inspection. */
  get executedCount(): number {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.status === 'executed') count += 1;
    }
    return count;
  }

  reset(): void {
    this.records.clear();
  }
}

function callKey(toolName: string, hash: string): string {
  return `${toolName}::${hash}`;
}

/**
 * Recursively canonical JSON for a value:
 * - object keys sorted recursively, so `{payload:{a,b}}` and
 *   `{payload:{b,a}}` hash identically;
 * - arrays preserve order;
 * - primitives returned as-is.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalize(record[key]);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic canonical hash of a tool call's arguments.
 *
 * - Key-ordered *recursively* so nested JSON key order does not matter.
 * - Strips `approvalId` — a replayed call with only the approval id
 *   changed is the same action, not a new one.
 * - Does NOT include credentials; only the tool name and observable
 *   arguments participate.
 */
export function normalizeArgsHash(call: AgentToolCall): string {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(call.args)) {
    if (key === 'approvalId') continue;
    stripped[key] = value;
  }
  return JSON.stringify(canonicalize(stripped));
}
