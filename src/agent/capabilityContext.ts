import type { ConnectionRecord } from '@mobile-agent/connector-core';

import type { ConnectionSummary } from './types';

/**
 * Builds the compact, secret-free capability context the model sees before
 * planning. Only connected accounts are listed — the model is never told a
 * connector exists if the user has not authorized it, and nothing here ever
 * contains a credential (ids, provider, display name, capabilities only).
 */
export function toConnectionSummaries(
  connections: readonly ConnectionRecord[],
): ConnectionSummary[] {
  return connections
    .filter((connection) => connection.status === 'connected')
    .map((connection) => ({
      id: connection.id,
      provider: connection.connectorId,
      displayName: connection.displayName,
      capabilities: connection.capabilities,
    }));
}
