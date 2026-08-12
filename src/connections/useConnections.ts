import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectorId } from '@mobile-agent/connector-core';

import {
  connectConnector,
  disconnectConnection,
  listConnections,
  reconnectConnection,
} from './connectionService';
import { getRegisteredConnectorIds } from '@/mcp/runtime-singleton';
import { MCP_RUNTIME_QUERY_KEY } from '@/mcp/queryKeys';

export const CONNECTIONS_QUERY_KEY = ['connections'] as const;
export const REGISTERED_CONNECTORS_QUERY_KEY = ['registered-connectors'] as const;

/**
 * UI synchronization with the persistent connection store. Every mutation
 * invalidates the connection queries, so onboarding, Account → Connectors
 * and the agent capability context all converge on the same truth.
 */
export function useConnections() {
  return useQuery({
    queryKey: CONNECTIONS_QUERY_KEY,
    queryFn: listConnections,
  });
}

/**
 * The set of connector ids the live runtime actually registered. Availability
 * is derived from the registry, not re-encoded in the catalogue, so a mock
 * connector omitted from a production build reads as "Coming soon" instead of
 * failing on tap.
 */
export function useRegisteredConnectorIds() {
  return useQuery({
    queryKey: REGISTERED_CONNECTORS_QUERY_KEY,
    queryFn: getRegisteredConnectorIds,
  });
}

export function useConnection(connectorId: ConnectorId) {
  const connections = useConnections();
  return {
    ...connections,
    connection:
      connections.data?.find((record) => record.connectorId === connectorId) ??
      null,
  };
}

export function useConnectConnector() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: connectConnector,
    onSettled: () =>
      invalidateConnectionRuntime(queryClient),
  });
}

export function useDisconnectConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disconnectConnection,

    onSettled: () => invalidateConnectionRuntime(queryClient),
  });
}

export function useReconnectConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: reconnectConnection,

    onSettled: () => invalidateConnectionRuntime(queryClient),
  });
}

async function invalidateConnectionRuntime(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: CONNECTIONS_QUERY_KEY,
    }),
    queryClient.invalidateQueries({
      queryKey: REGISTERED_CONNECTORS_QUERY_KEY,
    }),
    queryClient.invalidateQueries({
      queryKey: MCP_RUNTIME_QUERY_KEY,
    }),
  ]);
}