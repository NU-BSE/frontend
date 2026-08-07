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

function hashArgs(input: Record<string, unknown>): string {
  const sorted = JSON.stringify(input, Object.keys(input).sort());
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash << 5) - hash + sorted.charCodeAt(i)) | 0;
  }
  return `h_${Math.abs(hash).toString(36)}`;
}
