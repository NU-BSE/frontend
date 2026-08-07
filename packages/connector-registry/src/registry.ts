import type {
  Connector,
  ConnectorId,
  ConnectionRecord,
  ConnectorTool,
} from '@mobile-agent/connector-core';

export class ConnectorRegistry {
  private readonly connectors = new Map<ConnectorId, Connector>();

  register(connector: Connector): void {
    this.connectors.set(connector.id, connector);
  }

  get(id: ConnectorId): Connector {
    const connector = this.connectors.get(id);
    if (!connector) throw new Error(`Connector ${id} is not registered`);
    return connector;
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
          result.push({ connection, tool });
        }
      }
    }

    return result;
  }
}
