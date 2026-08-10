import type { ConnectionRecord, ConnectorId } from './types';

export interface ConnectionStore {
  get(id: string): Promise<ConnectionRecord | null>;
  list(): Promise<ConnectionRecord[]>;
  listByConnector(connectorId: ConnectorId): Promise<ConnectionRecord[]>;
  save(connection: ConnectionRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Test/dev store with no persistence. */
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
    this.connections.set(connection.id, { ...connection });
  }

  async remove(id: string): Promise<void> {
    this.connections.delete(id);
  }
}

/**
 * Minimal key/value seam so the persistent store stays free of
 * platform dependencies. The app plugs AsyncStorage in; tests plug a fake.
 */
export interface KeyValueBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const DEFAULT_STORAGE_KEY = 'creepyim.connections.v1';
const CURRENT_VERSION = 1;

interface StoreDocumentV1 {
  version: 1;
  connections: ConnectionRecord[];
}

type StoreDocument = StoreDocumentV1;

function isConnectionRecord(value: unknown): value is ConnectionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<ConnectionRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.connectorId === 'string' &&
    typeof record.displayName === 'string' &&
    typeof record.status === 'string' &&
    Array.isArray(record.scopes) &&
    Array.isArray(record.capabilities) &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number'
  );
}

/**
 * Persists connection metadata across app restarts.
 *
 * Stores metadata only — `credentialReference` is a pointer, never a secret.
 * The document is versioned so future schema changes can migrate forward
 * (`migrate` is the single place a new version gets handled).
 */
export class PersistentConnectionStore implements ConnectionStore {
  private cache: Map<string, ConnectionRecord> | null = null;

  constructor(
    private readonly backend: KeyValueBackend,
    private readonly storageKey: string = DEFAULT_STORAGE_KEY,
  ) {}

  async get(id: string): Promise<ConnectionRecord | null> {
    const connections = await this.load();
    return connections.get(id) ?? null;
  }

  async list(): Promise<ConnectionRecord[]> {
    const connections = await this.load();
    return [...connections.values()];
  }

  async listByConnector(connectorId: ConnectorId): Promise<ConnectionRecord[]> {
    const connections = await this.load();
    return [...connections.values()].filter(
      (connection) => connection.connectorId === connectorId,
    );
  }

  async save(connection: ConnectionRecord): Promise<void> {
    const connections = await this.load();
    connections.set(connection.id, { ...connection });
    await this.persist(connections);
  }

  async remove(id: string): Promise<void> {
    const connections = await this.load();
    connections.delete(id);
    await this.persist(connections);
  }

  private async load(): Promise<Map<string, ConnectionRecord>> {
    if (this.cache) return this.cache;

    let connections = new Map<string, ConnectionRecord>();
    try {
      const raw = await this.backend.getItem(this.storageKey);
      if (raw) {
        const document = this.migrate(JSON.parse(raw) as unknown);
        for (const connection of document.connections) {
          connections.set(connection.id, connection);
        }
      }
    } catch {
      // A corrupted document must not crash the app; it degrades to an empty
      // store which the next save() overwrites.
      connections = new Map();
    }

    this.cache = connections;
    return connections;
  }

  private migrate(parsed: unknown): StoreDocument {
    if (typeof parsed !== 'object' || parsed === null) {
      return { version: CURRENT_VERSION, connections: [] };
    }

    const document = parsed as { version?: unknown; connections?: unknown };

    switch (document.version) {
      case 1: {
        const connections = Array.isArray(document.connections)
          ? document.connections.filter(isConnectionRecord)
          : [];
        return { version: 1, connections };
      }
      default:
        // Unknown future or missing version: start clean rather than guess.
        return { version: CURRENT_VERSION, connections: [] };
    }
  }

  private async persist(
    connections: Map<string, ConnectionRecord>,
  ): Promise<void> {
    const document: StoreDocument = {
      version: CURRENT_VERSION,
      connections: [...connections.values()],
    };
    await this.backend.setItem(this.storageKey, JSON.stringify(document));
    this.cache = connections;
  }
}
