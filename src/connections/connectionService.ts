import type {
  ConnectionRecord,
  ConnectorId,
} from '@mobile-agent/connector-core';
import { ConnectorError, isConnectable } from '@mobile-agent/connector-core';

import {
  getConnectionStore,
  getCredentialVault,
  getCurrentRegistry,
  getLocalMcpRuntime,
  restartLocalMcpRuntime,
} from '@/mcp/runtime-singleton';

/**
 * The persistent connection service the UI reads from and writes to.
 *
 * This is the single source of truth shared by onboarding, Account →
 * Connectors, MCP tool registration and connector auth flows. There is never
 * one connection state in React and a different one in MCP: both read the
 * same ConnectionStore, and every mutation restarts the MCP runtime so the
 * registered tool list matches reality.
 */
export interface ConnectionService {
  list(): Promise<ConnectionRecord[]>;
  connect(connectorId: ConnectorId): Promise<ConnectionRecord>;
  disconnect(connectionId: string): Promise<void>;
  reconnect(connectionId: string): Promise<void>;
}

export async function listConnections(): Promise<ConnectionRecord[]> {
  return getConnectionStore().list();
}

/**
 * Creates a connection through the connector's real auth flow.
 *
 * Production never manufactures connections: mock connectors are not
 * registered there, and a connector without a `connect` implementation
 * reports an honest error instead of flipping a label to "Connected".
 */
export async function connectConnector(
  connectorId: ConnectorId,
): Promise<ConnectionRecord> {
  await getLocalMcpRuntime();

  const registry = getCurrentRegistry();
  if (!registry) {
    throw new ConnectorError('MCP runtime is not ready', 'PROVIDER_ERROR');
  }

  let connector;
  try {
    connector = registry.get(connectorId);
  } catch {
    throw new ConnectorError(
      `Connector "${connectorId}" is not available in this build.`,
      'UNSUPPORTED',
    );
  }

  if (!isConnectable(connector)) {
    throw new ConnectorError(
      `Connector "${connectorId}" does not support a connect flow yet.`,
      'UNSUPPORTED',
    );
  }

  const record = await connector.connect();

  // The tool list changed — rebuild the MCP runtime so the model sees it.
  await restartLocalMcpRuntime();

  return record;
}

export async function disconnectConnection(
  connectionId: string,
): Promise<void> {
  await getLocalMcpRuntime();

  const store = getConnectionStore();
  const record = await store.get(connectionId);
  if (!record) return;

  const registry = getCurrentRegistry();

  try {
    const connector = registry?.get(record.connectorId);
    if (connector) {
      await connector.disconnect(connectionId);
    } else {
      await store.remove(connectionId);
    }
  } catch {
    // Even if provider-side teardown fails, drop the local record so the
    // tools disappear — a disconnected account must never expose tools.
    await store.remove(connectionId);
  }

  // Revoke stored credentials — a disconnect must not leave secrets behind.
  if (record.credentialReference) {
    try {
      await getCredentialVault().remove(record.credentialReference);
    } catch {
      // Best-effort: the connection record is already gone, so the
      // credential is unreachable either way.
    }
  }

  await restartLocalMcpRuntime();
}

export async function reconnectConnection(
  connectionId: string,
): Promise<void> {
  const store = getConnectionStore();
  const record = await store.get(connectionId);
  if (!record) {
    throw new ConnectorError(
      `Connection "${connectionId}" was not found.`,
      'NOT_CONNECTED',
    );
  }

  // Re-run the connector's auth flow, then drop the stale record if the
  // fresh one got a new id.
  const fresh = await connectConnector(record.connectorId);
  if (fresh.id !== connectionId) {
    await store.remove(connectionId);

    // The old record may point at a credential the fresh record no longer
    // uses — drop it so a re-keyed account does not leak a stale grant.
    if (
      record.credentialReference &&
      record.credentialReference !== fresh.credentialReference
    ) {
      try {
        await getCredentialVault().remove(record.credentialReference);
      } catch {
        // Best-effort: unreachable either way once the record is gone.
      }
    }

    await restartLocalMcpRuntime();
  }
}

/**
 * Remove every connection and every secret behind them.
 *
 * Used by sign-out. Each connection goes through `disconnectConnection` rather
 * than being deleted from the store, so provider-side teardown still runs — a
 * Telegram sign-out has to reach TDLib, or the session stays alive on the
 * device after the account it belonged to is gone.
 *
 * Failures are absorbed per connection. A provider that will not answer must
 * not leave the other accounts connected: signing out has to finish.
 */
export async function disconnectEverything(): Promise<void> {
  const records = await getConnectionStore().list();

  for (const record of records) {
    try {
      await disconnectConnection(record.id);
    } catch {
      // Fall back to removing the record and its secret directly, so a
      // connector that throws cannot keep either behind.
      try {
        await getConnectionStore().remove(record.id);
        if (record.credentialReference) {
          await getCredentialVault().remove(record.credentialReference);
        }
      } catch {
        // Nothing further to try for this one.
      }
    }
  }
}

export const connectionService: ConnectionService = {
  list: listConnections,
  connect: connectConnector,
  disconnect: disconnectConnection,
  reconnect: reconnectConnection,
};
