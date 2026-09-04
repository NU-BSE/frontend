import {
  InMemoryApprovalStore,
  MockCalendarConnector,
} from '@mobile-agent/connector-mock';
import { InMemoryApprovalService } from '@mobile-agent/approval-core';
import { DefaultPolicyEngine } from '@mobile-agent/policy-core';
import {
  InMemoryConnectionStore,
  isConnectable,
  isDisposableConnector,
  type ConnectionStore,
} from '@mobile-agent/connector-core';
import {
  InMemoryCredentialVault,
  type CredentialVault,
} from '@mobile-agent/credential-vault';
import {
  createLocalMcpRuntime,
  type LocalMcpRuntime,
} from '@mobile-agent/mcp-client';

import { createConnectorRegistry } from './create-connector-registry';
import type { ConnectorRegistry } from '@mobile-agent/connector-registry';
import { seedDevelopmentConnections, removeDevelopmentConnections } from './dev-seed';
import { resolveDefaultRuntimeMode, type McpRuntimeMode } from './runtime-mode';
import { resolveTelegramAdapterMode } from './telegram-adapter-mode';

export interface AppMcpDependencies {
  connectionStore: ConnectionStore;
  credentialVault: CredentialVault;
}

let appDependencies: AppMcpDependencies | null = null;
let fallbackStore: InMemoryConnectionStore | null = null;
let fallbackVault: InMemoryCredentialVault | null = null;

let runtimePromise: Promise<LocalMcpRuntime> | null = null;
let runtimeMode: McpRuntimeMode | null = null;
let currentRegistry: ConnectorRegistry | null = null;
let approvalStore: InMemoryApprovalStore | null = null;
let approvalService: InMemoryApprovalService | null = null;
let devConnectionsSeeded = false;

export function configureAppDependencies(deps: AppMcpDependencies): void {
  appDependencies = deps;
}

export function getConnectionStore(): ConnectionStore {
  if (appDependencies) return appDependencies.connectionStore;
  if (!fallbackStore) fallbackStore = new InMemoryConnectionStore();
  return fallbackStore;
}

async function reconcileConnectionCredentials(
  connectionStore: ConnectionStore,
  credentialVault: CredentialVault,
): Promise<void> {
  const connections = await connectionStore.list();
  for (const connection of connections) {
    if (connection.status !== 'connected') continue;
    if (!connection.credentialReference) continue;
    const credential = await credentialVault.get(connection.credentialReference);
    if (!credential) {
      await connectionStore.save({
        ...connection,
        status: 'reconnect_required',
        updatedAt: Date.now(),
      });
    }
  }
}

export function getCredentialVault(): CredentialVault {
  if (appDependencies) return appDependencies.credentialVault;
  if (!fallbackVault) fallbackVault = new InMemoryCredentialVault();
  return fallbackVault;
}

/**
 * Android Settings and Intents are local device capabilities, not external
 * accounts. When their real native connector is registered, ensure its stable
 * local connection exists before MCP enumerates active tools.
 */
async function ensureLocalDeviceConnections(
  registry: ConnectorRegistry,
): Promise<void> {
  for (const connectorId of ['android', 'intent'] as const) {
    try {
      const connector = registry.get(connectorId);
      if (isConnectable(connector)) {
        await connector.connect();
      }
    } catch {
      // Connector absent on this platform/build, or the native bridge failed.
      // Do not manufacture a connection; the connector will simply expose no tools.
    }
  }
}

export interface GetRuntimeOptions {
  /** First call wins; later calls reuse the singleton's mode. */
  mode?: McpRuntimeMode;
}

/**
 * Singleton local MCP runtime. Development may expose explicit mocks;
 * production registers only real connectors.
 */
export function getLocalMcpRuntime(
  options: GetRuntimeOptions = {},
): Promise<LocalMcpRuntime> {
  if (!runtimePromise) {
    const mode = options.mode ?? resolveDefaultRuntimeMode();
    runtimeMode = mode;

    const store = new InMemoryApprovalStore();
    const service = new InMemoryApprovalService();
    const connectionStore = getConnectionStore();

    runtimePromise = (async () => {
      if (mode === 'production') {
        await removeDevelopmentConnections(connectionStore);
        await reconcileConnectionCredentials(
          connectionStore,
          getCredentialVault(),
        );
      } else if (!devConnectionsSeeded) {
        const telegramMode = resolveTelegramAdapterMode(mode);
        await seedDevelopmentConnections(connectionStore, {
          skipTelegramSeed: telegramMode === 'native',
        });
        if (telegramMode === 'native') {
          await connectionStore.remove('telegram-user-default');
        }
        devConnectionsSeeded = true;
      }

      const registry = createConnectorRegistry({
        mode,
        connectionStore,
        credentialVault: getCredentialVault(),
      });
      currentRegistry = registry;

      await ensureLocalDeviceConnections(registry);

      return createLocalMcpRuntime(
        {
          // The built-in calendar contract still requires an implementation;
          // in production its tools are simply not registered.
          calendar: new MockCalendarConnector(),
          approvals: store,
        },
        {
          registry,
          policyEngine: new DefaultPolicyEngine(),
          approvalService: service,
        },
        {
          builtInCalendar: mode === 'development',
        },
      );
    })()
      .then((runtime) => {
        approvalStore = store;
        approvalService = service;
        return runtime;
      })
      .catch((error) => {
        runtimePromise = null;
        runtimeMode = null;
        currentRegistry = null;
        throw error;
      });
  }

  return runtimePromise;
}

export function getRuntimeMode(): McpRuntimeMode | null {
  return runtimeMode;
}

export function getCurrentRegistry(): ConnectorRegistry | null {
  return currentRegistry;
}

export async function getRegisteredConnectorIds(): Promise<Set<string>> {
  await getLocalMcpRuntime();
  const registry = getCurrentRegistry();
  if (!registry) return new Set();
  return new Set(registry.listConnectors().map((connector) => connector.id));
}

/**
 * Re-derive the local device connections' scopes.
 *
 * `AndroidConnector.connect()` reads WRITE_SETTINGS and overlay access at the
 * moment it runs and writes the resulting scopes onto the connection record.
 * Those grants are made on a system screen, outside this app, so a record
 * created before the grant keeps saying the permission is absent — and
 * `android.settings.set_brightness` keeps failing with "missing required
 * scopes: android.settings.write" long after the user has granted it. Until
 * now only a restart fixed that.
 *
 * Cheap enough to call whenever the app returns to the foreground: it touches
 * the two local connectors, and each writes only if something changed.
 */
export async function refreshLocalDeviceConnections(): Promise<void> {
  const registry = getCurrentRegistry();
  if (!registry) return;
  await ensureLocalDeviceConnections(registry);
}

export async function restartLocalMcpRuntime(): Promise<LocalMcpRuntime> {
  const mode = runtimeMode;
  await closeLocalMcpRuntime();
  return getLocalMcpRuntime(mode ? { mode } : {});
}

export function issueToolApproval(input: {
  toolName: string;
  payload: Record<string, unknown>;
}): string {
  if (!approvalStore) {
    throw new Error('MCP runtime is not initialized');
  }

  return approvalStore.issue(input);
}

export async function approveConnectorTool(approvalId: string): Promise<void> {
  if (!approvalService) {
    throw new Error('MCP runtime is not initialized');
  }

  await approvalService.approve(approvalId);
}

export async function closeLocalMcpRuntime(): Promise<void> {
  if (!runtimePromise) {
    return;
  }

  const runtime = await runtimePromise;

  try {
    if (currentRegistry) {
      for (const connector of currentRegistry.listConnectors()) {
        if (isDisposableConnector(connector)) {
          try { await connector.dispose(); } catch { /* best-effort */ }
        }
      }
    }

    await runtime.close();
  } finally {
    runtimePromise = null;
    runtimeMode = null;
    currentRegistry = null;
    approvalStore = null;
    approvalService = null;
  }
}
