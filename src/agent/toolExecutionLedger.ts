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
    | 'cancelled';
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
    } else {
      status = 'failed';
    }

    this.records.set(callKey(call.toolName, hash), {
      toolCallId: call.id,
      toolName: call.toolName,
      argsHash: hash,
      status,
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
 * Deterministic canonical hash of a tool call's arguments.
 *
 * - Key-ordered so JSON key order does not matter.
 * - Strips `approvalId` — a replayed call with only the approval id
 *   changed is the same action, not a new one.
 * - Does NOT include credentials; only the tool name and observable
 *   arguments participate.
 */
export function normalizeArgsHash(call: AgentToolCall): string {
  const sorted = Object.keys(call.args)
    .filter((key) => key !== 'approvalId')
    .sort();
  const pairs: string[] = [];
  for (const key of sorted) {
    pairs.push(`${key}:${JSON.stringify(call.args[key])}`);
  }
  return pairs.join('|');
}
