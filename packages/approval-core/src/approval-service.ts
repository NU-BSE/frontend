import type { ConnectionRecord, ConnectorTool } from '@mobile-agent/connector-core';

export interface ApprovalRecord {
  id: string;
  taskId: string;
  toolName: string;
  connectionId: string;
  argumentsHash: string;
  createdAt: number;
  expiresAt: number;
  approvedAt?: number;
  consumedAt?: number;
}

export interface ApprovalPreview {
  toolName: string;
  connectionId: string;
  summary: string;
}

export interface CreateApprovalInput {
  connection: ConnectionRecord;
  tool: ConnectorTool<any, any>;
  input: Record<string, unknown>;
}

export interface ApprovalService {
  create(input: CreateApprovalInput): Promise<{ id: string; preview: ApprovalPreview }>;
  approve(approvalId: string): Promise<void>;
  consume(approvalId: string, argumentsHash: string): Promise<void>;
}

export class InMemoryApprovalService implements ApprovalService {
  private readonly approvals = new Map<string, ApprovalRecord>();
  private counter = 0;

  async create(input: CreateApprovalInput) {
    this.counter += 1;
    const id = `approval-${this.counter}`;
    const argsHash = hashArgs(input.input);

    this.approvals.set(id, {
      id,
      taskId: `task-${Date.now()}`,
      toolName: input.tool.name,
      connectionId: input.connection.id,
      argumentsHash: argsHash,
      createdAt: Date.now(),
      expiresAt: Date.now() + 300_000,
    });

    return {
      id,
      preview: {
        toolName: input.tool.name,
        connectionId: input.connection.id,
        summary: `${input.tool.title}: ${JSON.stringify(input.input).slice(0, 200)}`,
      },
    };
  }

  async approve(approvalId: string): Promise<void> {
    const record = this.approvals.get(approvalId);
    if (!record) throw new Error('Approval not found');
    if (record.approvedAt) throw new Error('Already approved');
    record.approvedAt = Date.now();
  }

  async consume(approvalId: string, argumentsHash: string): Promise<void> {
    const record = this.approvals.get(approvalId);
    if (!record) throw new Error('Approval not found');
    if (!record.approvedAt) throw new Error('Not yet approved');
    if (record.consumedAt) throw new Error('Already consumed');
    if (record.argumentsHash !== argumentsHash) throw new Error('Arguments do not match approved payload');
    record.consumedAt = Date.now();
  }
}

/**
 * Stable hash of a tool's arguments, used to bind an approval to the exact
 * payload the user saw. Exported because the caller that redeems an approval
 * must derive the same value from the arguments it is about to execute — if
 * the model alters so much as a recipient between approval and execution, the
 * hashes diverge and `consume` rejects it.
 */
export function hashArgs(input: Record<string, unknown>): string {
  const canonical = JSON.stringify(canonicalize(input));
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) - hash + canonical.charCodeAt(i)) | 0;
  }
  return `h_${Math.abs(hash).toString(36)}`;
}

/**
 * Order-independent deep copy: object keys are sorted at every level so that
 * two payloads differing only in key order hash identically.
 *
 * This replaces `JSON.stringify(input, Object.keys(input).sort())`. That form
 * looks like a sort but the second argument is a *replacer allowlist*, applied
 * at every depth — so any nested key absent from the top-level key list was
 * silently dropped before hashing. `{to, body:{text}}` hashed without `text`
 * at all, meaning an approval for one message body would validate a call
 * carrying a completely different one. Arrays keep their order, which is
 * meaningful data rather than incidental.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])] as const),
    );
  }

  return value;
}
