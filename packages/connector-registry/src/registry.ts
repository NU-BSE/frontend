import type {
  Connector,
  ConnectorId,
  ConnectionRecord,
  ConnectorTool,
} from '@mobile-agent/connector-core';

export interface ConnectorRegistryOptions {
  /**
   * Development runtimes may expose tools marked `development_mock`.
   * Production must leave this off so the model never sees tools that would
   * report fake success.
   */
  allowDevelopmentMocks?: boolean;
}

export class ConnectorRegistry {
  private readonly connectors = new Map<ConnectorId, Connector>();
  private readonly allowDevelopmentMocks: boolean;

  constructor(options: ConnectorRegistryOptions = {}) {
    this.allowDevelopmentMocks = options.allowDevelopmentMocks ?? false;
  }

  register(connector: Connector): void {
    this.connectors.set(connector.id, connector);
  }

  get(id: ConnectorId): Connector {
    const connector = this.connectors.get(id);
    if (!connector) throw new Error(`Connector ${id} is not registered`);
    return connector;
  }

  listConnectors(): Connector[] {
    return [...this.connectors.values()];
  }

  /**
   * Resolves a connection by id across all registered connectors.
   * Tool handlers use this at execution time (with `input.connectionId`)
   * instead of capturing one connection at registration — which is what lets
   * one MCP tool name serve many accounts.
   */
  async getConnection(
    connectionId: string,
  ): Promise<{ connector: Connector; connection: ConnectionRecord } | null> {
    for (const connector of this.connectors.values()) {
      const connection = await connector.getConnection(connectionId);
      if (connection) return { connector, connection };
    }
    return null;
  }

  /** Every connection known to any connector, in any status. */
  async listConnections(): Promise<ConnectionRecord[]> {
    const result: ConnectionRecord[] = [];
    for (const connector of this.connectors.values()) {
      result.push(...(await connector.listConnections()));
    }
    return result;
  }

  async listActiveTools(): Promise<
    Array<{ connection: ConnectionRecord; tool: ConnectorTool<any, any> }>
  > {
    const result: Array<{ connection: ConnectionRecord; tool: ConnectorTool<any, any> }> = [];

    for (const connector of this.connectors.values()) {
      const connections = await connector.listConnections();

      for (const connection of connections) {
        if (connection.status !== 'connected') continue;

        const tools = await connector.getTools(connection);

        for (const tool of tools) {
          if (!this.isToolExposed(tool)) continue;
          result.push({ connection, tool });
        }
      }
    }

    return result;
  }

  private isToolExposed(tool: ConnectorTool<any, any>): boolean {
    const status = tool.implementationStatus ?? 'development_mock';
    if (status === 'unsupported') return false;
    if (status === 'development_mock' && !this.allowDevelopmentMocks) {
      return false;
    }
    return true;
  }
}
