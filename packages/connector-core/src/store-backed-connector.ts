import type {
  ConnectionRecord,
  Connector,
  ConnectorId,
  ConnectorImplementationStatus,
  ConnectorTool,
} from './types';
import type { ConnectionStore } from './store';

export interface StoreBackedConnectorOptions {
  store: ConnectionStore;
}

/**
 * Base class for connectors whose connection list lives in the shared
 * ConnectionStore — the single source of truth shared by the UI, the MCP
 * registry and connector auth flows.
 *
 * Subclasses implement `getTools` (and optionally `connect`); they must not
 * keep their own private connection state.
 */
export abstract class StoreBackedConnector implements Connector {
  abstract readonly id: ConnectorId;
  abstract readonly displayName: string;
  abstract readonly implementationStatus: ConnectorImplementationStatus;

  protected readonly store: ConnectionStore;

  constructor(options: StoreBackedConnectorOptions) {
    this.store = options.store;
  }

  async listConnections(): Promise<ConnectionRecord[]> {
    return this.store.listByConnector(this.id);
  }

  async getConnection(connectionId: string): Promise<ConnectionRecord | null> {
    const connection = await this.store.get(connectionId);
    return connection && connection.connectorId === this.id
      ? connection
      : null;
  }

  abstract getTools(
    connection: ConnectionRecord,
  ): Promise<ConnectorTool<any, any>[]>;

  /**
   * Default disconnect removes the record from the store. Connectors that
   * also need provider-side revocation or credential cleanup override this
   * and call `super.disconnect` afterwards.
   */
  async disconnect(connectionId: string): Promise<void> {
    const connection = await this.getConnection(connectionId);
    if (!connection) return;
    await this.store.remove(connectionId);
  }
}
