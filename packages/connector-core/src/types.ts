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

/**
 * How real a connector package is.
 *
 * The production registry refuses to register `mock` connectors unless a
 * development flag explicitly enables them, so the model can never see tools
 * that would report fake success.
 */
export type ConnectorImplementationStatus = 'mock' | 'partial' | 'production';

/**
 * Per-tool honesty marker. A tool must never return a fake successful result
 * in production: it is either implemented (`real`), explicitly unavailable
 * (`unsupported`), or only allowed to run in development (`development_mock`).
 */
export type ToolImplementationStatus = 'real' | 'unsupported' | 'development_mock';

export interface ConnectionRecord {
  id: string;
  connectorId: ConnectorId;
  externalAccountId?: string;
  displayName: string;
  status: ConnectionStatus;
  scopes: string[];
  capabilities: string[];
  /**
   * Pointer into the CredentialVault. Deliberately not the credential itself:
   * connection metadata may be persisted and synced, secrets may not.
   */
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
  /** Defaults to `development_mock` when omitted. */
  implementationStatus?: ToolImplementationStatus;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

/**
 * Optional capability: connectors that support a user-initiated account
 * connection (OAuth, phone/code login, device pairing) implement this.
 * The returned record must already be persisted in the connection store.
 */
export interface ConnectableConnector {
  connect(input?: Record<string, unknown>): Promise<ConnectionRecord>;
}

export interface Connector {
  readonly id: ConnectorId;
  readonly displayName: string;
  /** Honesty marker — the production registry filters on this. */
  readonly implementationStatus: ConnectorImplementationStatus;
  listConnections(): Promise<ConnectionRecord[]>;
  getConnection(connectionId: string): Promise<ConnectionRecord | null>;
  getTools(connection: ConnectionRecord): Promise<ConnectorTool<any, any>[]>;
  disconnect(connectionId: string): Promise<void>;
}

export function isConnectable(
  connector: Connector,
): connector is Connector & ConnectableConnector {
  return (
    typeof (connector as unknown as ConnectableConnector).connect ===
    'function'
  );
}
