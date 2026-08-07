import type * as z from 'zod/v4';

export type ConnectorId =
  | 'android'
  | 'google'
  | 'telegram-bot'
  | 'telegram-user'
  | 'microsoft'
  | 'slack'
  | 'notion'
  | 'todoist'
  | 'github'
  | 'dropbox'
  | 'discord'
  | 'spotify'
  | 'intent';

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'expired'
  | 'reconnect_required'
  | 'permission_required'
  | 'error';

export type ToolRisk =
  | 'read'
  | 'write'
  | 'external_side_effect'
  | 'destructive';

export interface ConnectionRecord {
  id: string;
  connectorId: ConnectorId;
  externalAccountId?: string;
  displayName: string;
  status: ConnectionStatus;
  scopes: string[];
  capabilities: string[];
  credentialReference?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ToolExecutionContext {
  taskId: string;
  agentId: string;
  connection: ConnectionRecord;
  approvalId?: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface ConnectorTool<
  TInput = unknown,
  TOutput = unknown,
> {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  risk: ToolRisk;
  capabilities: string[];
  requiredScopes: string[];
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

export interface Connector {
  readonly id: ConnectorId;
  readonly displayName: string;
  listConnections(): Promise<ConnectionRecord[]>;
  getConnection(connectionId: string): Promise<ConnectionRecord | null>;
  getTools(connection: ConnectionRecord): Promise<ConnectorTool<any, any>[]>;
  disconnect(connectionId: string): Promise<void>;
}
