import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectorId } from '@mobile-agent/connector-core';

import {
  connectConnector,
  disconnectConnection,
  listConnections,
  reconnectConnection,
} from './connectionService';

export const CONNECTIONS_QUERY_KEY = ['connections'] as const;

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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY }),
    onError: () =>
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY }),
  });
}

export function useDisconnectConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectConnection,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY }),
    onError: () =>
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY }),
  });
}

export function useReconnectConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reconnectConnection,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY }),
    onError: () =>
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY }),
  });
}
