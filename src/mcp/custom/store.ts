/**
 * Persistence for user-added MCP servers.
 *
 * Two stores, split along the line the rest of the app already draws:
 * metadata in AsyncStorage, secrets in the credential vault (expo-secure-store,
 * Android Keystore-backed). A `CustomMcpServer` record holds only the names of
 * the variables that have values — enough to render "GITHUB_TOKEN is still
 * needed" without reading a single secret to find out.
 *
 * Each variable is stored as its own vault entry rather than one blob per
 * server. Removing a server then deletes exactly the entries it owns, and a
 * corrupted single value cannot take the rest of the configuration with it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { getCredentialVault } from '@/mcp/runtime-singleton';

import {
  defaultLabel,
  type CustomMcpServer,
  type CustomMcpSource,
  type DetectedMcp,
} from './types';

const SERVERS_KEY = 'creepyim.mcp.custom-servers.v1';

/** Vault reference for one variable of one server. */
function variableReference(serverId: string, name: string): string {
  return `custom-mcp/${serverId}/${name}`;
}

/**
 * Ids are generated here rather than derived from the URL.
 *
 * Two entries for the same repository at different refs are two servers, and a
 * URL that changes case or gains a trailing slash is the same one; deriving an
 * id from the URL gets both of those wrong.
 */
function newId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `mcp_${Date.now().toString(36)}_${random}`;
}

export async function listCustomServers(): Promise<CustomMcpServer[]> {
  try {
    const raw = await AsyncStorage.getItem(SERVERS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isServerRecord);
  } catch {
    // A corrupt list must not brick the screen that would let the user fix it.
    return [];
  }
}

/**
 * Structural check on every record read back.
 *
 * Storage outlives builds: a record written by an older version, or one that
 * was half-written when the app was killed, would otherwise reach the UI as an
 * object with missing fields and crash on first render.
 */
function isServerRecord(value: unknown): value is CustomMcpServer {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<CustomMcpServer>;
  return (
    typeof record.id === 'string' &&
    typeof record.label === 'string' &&
    typeof record.credentialReference === 'string' &&
    Array.isArray(record.configuredEnvironment) &&
    typeof record.source === 'object' &&
    record.source !== null
  );
}

async function writeAll(servers: CustomMcpServer[]): Promise<void> {
  await AsyncStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
}

export async function addCustomServer(
  source: CustomMcpSource,
  options: { label?: string; detected?: DetectedMcp | null } = {},
): Promise<CustomMcpServer> {
  const servers = await listCustomServers();
  const id = newId();
  const server: CustomMcpServer = {
    id,
    label: options.label?.trim() || defaultLabel(source),
    source,
    detected: options.detected ?? null,
    configuredEnvironment: [],
    credentialReference: `custom-mcp/${id}`,
    addedAt: Date.now(),
    resolvedAt: options.detected ? Date.now() : null,
  };
  await writeAll([...servers, server]);
  return server;
}

export async function updateDetection(
  id: string,
  detected: DetectedMcp,
): Promise<CustomMcpServer | null> {
  const servers = await listCustomServers();
  const index = servers.findIndex((server) => server.id === id);
  if (index < 0) return null;

  const previous = servers[index];
  if (!previous) return null;

  /*
   * Re-resolving can change which variables a server needs — a repository that
   * renames GITHUB_TOKEN to GH_TOKEN, say. A value held for a variable that is
   * no longer required stops counting as configured, so the status reflects
   * the new detection rather than the old one.
   *
   * Its secret is deleted rather than left behind. Dropping only the name
   * orphans the vault entry: nothing references it any more, so nothing will
   * ever clean it up, and removing the server later cannot either because the
   * record no longer knows it exists. A token for a variable the server has
   * stopped using is a liability with no upside.
   */
  const names = new Set(detected.requiredEnvironmentVariables.map((item) => item.name));
  const retained = previous.configuredEnvironment.filter((name) => names.has(name));
  const dropped = previous.configuredEnvironment.filter((name) => !names.has(name));

  if (dropped.length > 0) {
    const vault = getCredentialVault();
    for (const name of dropped) {
      await vault.remove(variableReference(id, name));
    }
  }

  const next: CustomMcpServer = {
    ...previous,
    detected,
    resolvedAt: Date.now(),
    configuredEnvironment: retained,
  };

  servers[index] = next;
  await writeAll(servers);
  return next;
}

export async function renameCustomServer(id: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  const servers = await listCustomServers();
  const index = servers.findIndex((server) => server.id === id);
  if (index < 0) return;
  const previous = servers[index];
  if (!previous) return;
  servers[index] = { ...previous, label: trimmed };
  await writeAll(servers);
}

/**
 * Store one environment value.
 *
 * An empty value clears the variable instead of storing a blank, which is what
 * a user who wants to remove a token will do.
 */
export async function setEnvironmentValue(
  id: string,
  name: string,
  value: string,
): Promise<void> {
  const servers = await listCustomServers();
  const index = servers.findIndex((server) => server.id === id);
  if (index < 0) return;
  const previous = servers[index];
  if (!previous) return;

  const vault = getCredentialVault();
  const reference = variableReference(id, name);
  const configured = new Set(previous.configuredEnvironment);

  if (value.length === 0) {
    await vault.remove(reference);
    configured.delete(name);
  } else {
    await vault.save(reference, { kind: 'static_token', token: value });
    configured.add(name);
  }

  servers[index] = { ...previous, configuredEnvironment: [...configured] };
  await writeAll(servers);
}

/**
 * Read the stored values back, for handing to a server at start time.
 *
 * Returns names mapped to values, so this is the one function here that
 * touches secrets. Nothing calls it to render a screen.
 */
export async function readEnvironment(id: string): Promise<Record<string, string>> {
  const servers = await listCustomServers();
  const server = servers.find((item) => item.id === id);
  if (!server) return {};

  const vault = getCredentialVault();
  const environment: Record<string, string> = {};
  for (const name of server.configuredEnvironment) {
    const credential = await vault.get(variableReference(id, name));
    if (credential && credential.kind === 'static_token') {
      environment[name] = credential.token;
    }
  }
  return environment;
}

/** Remove a server and every secret it owns. */
export async function removeCustomServer(id: string): Promise<void> {
  const servers = await listCustomServers();
  const server = servers.find((item) => item.id === id);

  if (server) {
    const vault = getCredentialVault();
    // Vault entries first: dropping the record first would orphan them with no
    // remaining record of which references to delete.
    for (const name of server.configuredEnvironment) {
      await vault.remove(variableReference(id, name));
    }
  }

  await writeAll(servers.filter((item) => item.id !== id));
}
