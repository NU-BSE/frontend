/**
 * Query bindings for user-added MCP servers.
 *
 * Every mutation invalidates the one list query, so the add screen, the
 * detail screen and the connector grid never disagree about what is
 * configured — the same discipline the connector hooks already follow.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addCustomServer,
  listCustomServers,
  removeCustomServer,
  renameCustomServer,
  setEnvironmentValue,
  updateDetection,
} from './store';
import { resolveCustomMcp } from './resolverClient';
import type { CustomMcpSource, DetectedMcp } from './types';

export const CUSTOM_SERVERS_QUERY_KEY = ['custom-mcp-servers'] as const;

export function useCustomServers() {
  return useQuery({
    queryKey: CUSTOM_SERVERS_QUERY_KEY,
    queryFn: listCustomServers,
  });
}

export function useCustomServer(id: string | undefined) {
  const servers = useCustomServers();
  return {
    ...servers,
    server: id ? (servers.data ?? []).find((item) => item.id === id) ?? null : null,
  };
}

/**
 * Resolve a source without storing anything.
 *
 * Detection is separated from adding on purpose: a user who pastes a URL for a
 * repository that turns out not to be an MCP server should see that before a
 * dead entry appears in their list.
 */
export function useResolveSource() {
  return useMutation({
    mutationFn: (input: { source: CustomMcpSource; prepare?: boolean }): Promise<DetectedMcp> =>
      resolveCustomMcp(input.source, { prepare: input.prepare === true }),
  });
}

export function useAddCustomServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      source: CustomMcpSource;
      label?: string;
      detected?: DetectedMcp | null;
    }) =>
      addCustomServer(input.source, {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.detected !== undefined ? { detected: input.detected } : {}),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: CUSTOM_SERVERS_QUERY_KEY });
    },
  });
}

/** Re-run detection against a stored server, e.g. after the repository moved on. */
export function useReresolveServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; source: CustomMcpSource; prepare?: boolean }) => {
      const detected = await resolveCustomMcp(input.source, {
        prepare: input.prepare === true,
      });
      return updateDetection(input.id, detected);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: CUSTOM_SERVERS_QUERY_KEY });
    },
  });
}

export function useSetEnvironmentValue() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name: string; value: string }) =>
      setEnvironmentValue(input.id, input.name, input.value),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: CUSTOM_SERVERS_QUERY_KEY });
    },
  });
}

export function useRenameCustomServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; label: string }) =>
      renameCustomServer(input.id, input.label),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: CUSTOM_SERVERS_QUERY_KEY });
    },
  });
}

export function useRemoveCustomServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeCustomServer(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: CUSTOM_SERVERS_QUERY_KEY });
    },
  });
}
