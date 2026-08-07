import type { ConnectionRecord, ConnectorTool, ToolRisk } from '@mobile-agent/connector-core';

export const DEFAULT_APPROVAL_POLICY: Record<ToolRisk, 'never' | 'configurable' | 'always'> = {
  read: 'never',
  write: 'configurable',
  external_side_effect: 'always',
  destructive: 'always',
};

export interface AuthorizationRequest {
  connection: ConnectionRecord;
  tool: ConnectorTool<any, any>;
  input: Record<string, unknown>;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
  taskId: string;
  agentId: string;
  idempotencyKey: string;
}

export interface PolicyEngine {
  authorize(request: AuthorizationRequest): Promise<AuthorizationResult>;
}

export class DefaultPolicyEngine implements PolicyEngine {
  private taskCounter = 0;

  async authorize(request: AuthorizationRequest): Promise<AuthorizationResult> {
    if (request.connection.status !== 'connected') {
      return {
        allowed: false,
        reason: `Connection ${request.connection.id} is ${request.connection.status}`,
        requiresApproval: false,
        taskId: '',
        agentId: '',
        idempotencyKey: '',
      };
    }

    const policy = DEFAULT_APPROVAL_POLICY[request.tool.risk];
    const requiresApproval = policy === 'always' || (policy === 'configurable' && request.tool.risk !== 'read');

    this.taskCounter += 1;
    const taskId = `task_${this.taskCounter}`;

    return {
      allowed: true,
      requiresApproval,
      taskId,
      agentId: 'local-agent',
      idempotencyKey: `${taskId}:step_01:v1`,
    };
  }
}
