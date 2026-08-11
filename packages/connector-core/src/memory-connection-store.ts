import type { ConnectionRecord, ConnectorId } from './types';
import type { ConnectionStore } from './store';

/**
 * Process-local connection store.
 *
 * The authority on which accounts are actually linked. Connectors no longer
 * answer that question themselves — every one of them reported a hardcoded
 * `status: 'connected'` fixture, so the agent was handed 146 tools for
 * services the user had never signed into.
 *
 * The app layers a persistent implementation over this same interface; this
 * one backs tests and the pre-connection state, where "nothing is connected"
 * is the correct answer.
 */
export class InMemoryConnectionStore implements ConnectionStore {
  private readonly connections = new Map<string, ConnectionRecord>();

  async get(id: string): Promise<ConnectionRecord | null> {
    return this.connections.get(id) ?? null;
  }

  async list(): Promise<ConnectionRecord[]> {
    return [...this.connections.values()];
  }

  async listByConnector(connectorId: ConnectorId): Promise<ConnectionRecord[]> {
    return [...this.connections.values()].filter(
      (connection) => connection.connectorId === connectorId,
    );
  }

  async save(connection: ConnectionRecord): Promise<void> {
    this.connections.set(connection.id, connection);
  }

  async remove(id: string): Promise<void> {
    this.connections.delete(id);
  }
}
