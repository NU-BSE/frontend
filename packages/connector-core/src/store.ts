import type {
  ConnectionRecord,
  ConnectorId,
} from '@mobile-agent/connector-core';

export interface ConnectionStore {
  get(id: string): Promise<ConnectionRecord | null>;
  list(): Promise<ConnectionRecord[]>;
  listByConnector(connectorId: ConnectorId): Promise<ConnectionRecord[]>;
  save(connection: ConnectionRecord): Promise<void>;
  remove(id: string): Promise<void>;
}
