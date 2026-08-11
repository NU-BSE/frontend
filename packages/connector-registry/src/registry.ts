import type {
  Connector,
  ConnectorId,
  ConnectionRecord,
  ConnectionStore,
  ConnectorTool,
} from '@mobile-agent/connector-core';

export class ConnectorRegistry {
  private readonly connectors = new Map<ConnectorId, Connector>();

  /**
   * @param connections The authority on which accounts are linked.
   *
   * Previously each connector answered that itself, and every one returned a
   * hardcoded `status: 'connected'` fixture — so the agent received tools for
   * services the user had never signed into, and could believe it was able to
   * send mail or post messages on their behalf. Connectedness now comes from
   * one store that only a completed authorization can write to.
   */
  constructor(private readonly connections: ConnectionStore) {}

  register(connector: Connector): void {
    this.connectors.set(connector.id, connector);
  }

  get(id: ConnectorId): Connector {
    const connector = this.connectors.get(id);
    if (!connector) throw new Error(`Connector ${id} is not registered`);
    return connector;
  }

  /**
   * Tools for linked accounts only.
   *
   * Returns an empty list when nothing is connected, which is the correct
   * starting state: an agent that cannot see a tool cannot claim to use it.
   */
  async listActiveTools(): Promise<
    Array<{ connection: ConnectionRecord; tool: ConnectorTool<any, any> }>
  > {
    const result: Array<{ connection: ConnectionRecord; tool: ConnectorTool<any, any> }> = [];

    for (const connector of this.connectors.values()) {
      const owned = connector.ownedConnectorIds ?? [connector.id];
      const connections: ConnectionRecord[] = [];
      for (const connectorId of owned) {
        connections.push(...(await this.connections.listByConnector(connectorId)));
      }

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
