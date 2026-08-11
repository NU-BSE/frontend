import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  ConnectionRecord,
  ConnectionStore,
  ConnectorId,
} from '@mobile-agent/connector-core';

const KEY = 'creepyim.connectors.connections.v1';

/**
 * Device-local record of which accounts are linked.
 *
 * Deliberately holds no secrets — only which connector is linked, its display
 * name, scopes and timestamps. Tokens live in the credential vault, wrapped by
 * a non-exportable Android Keystore key, and are never written here.
 *
 * Persisted on the device rather than server-side: the backend never learns
 * which third-party accounts a user has connected, which is the privacy
 * property this design exists to hold.
 */
export class PersistentConnectionStore implements ConnectionStore {
  private cache: Map<string, ConnectionRecord> | null = null;

  private async load(): Promise<Map<string, ConnectionRecord>> {
    if (this.cache) return this.cache;

    const next = new Map<string, ConnectionRecord>();
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ConnectionRecord[];
        // A malformed entry must not take the whole store down with it: a
        // corrupt record should cost one connection, not every connection.
        for (const record of Array.isArray(parsed) ? parsed : []) {
          if (record && typeof record.id === 'string') next.set(record.id, record);
        }
      }
    } catch {
      // Unreadable storage reads as "nothing connected", which fails closed.
    }

    this.cache = next;
    return next;
  }

  private async persist(): Promise<void> {
    const records = [...(this.cache?.values() ?? [])];
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(records));
    } catch {
      // Keep the in-memory view usable for this session even if the write
      // fails; the next launch simply shows the connection as absent.
    }
  }

  async get(id: string): Promise<ConnectionRecord | null> {
    return (await this.load()).get(id) ?? null;
  }

  async list(): Promise<ConnectionRecord[]> {
    return [...(await this.load()).values()];
  }

  async listByConnector(connectorId: ConnectorId): Promise<ConnectionRecord[]> {
    return [...(await this.load()).values()].filter(
      (connection) => connection.connectorId === connectorId,
    );
  }

  async save(connection: ConnectionRecord): Promise<void> {
    (await this.load()).set(connection.id, connection);
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    (await this.load()).delete(id);
    await this.persist();
  }
}
