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
import { removeDevelopmentConnections } from './dev-seed';
import { resolveDefaultRuntimeMode, type McpRuntimeMode } from './runtime-mode';

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

export function configureAppDependencies(deps: AppMcpDependencies): void {
  appDependencies = deps;
}

export function getConnectionStore(): ConnectionStore {
  if (appDependencies) return appDependencies.connectionStore;
  if (!fallbackStore) fallbackStore = new InMemoryConnectionStore();
  return fallbackStore;
}

/**
 * Connectors that are the device itself, and so have nothing to authenticate.
 *
 * Everything else is an account somewhere, and an account with no credential
 * is not connected however the record reads.
 */
export const LOCAL_DEVICE_CONNECTORS = ['android', 'intent'] as const;

async function reconcileConnectionCredentials(
  connectionStore: ConnectionStore,
  credentialVault: CredentialVault,
): Promise<void> {
  const local = new Set<string>(LOCAL_DEVICE_CONNECTORS);
  const connections = await connectionStore.list();

  for (const connection of connections) {
    if (connection.status !== 'connected') continue;
    if (local.has(connection.connectorId)) continue;

    /*
     * A missing reference is the failure, not a reason to skip.
     *
     * This used to `continue` when `credentialReference` was absent, so it
     * only ever caught a reference pointing at a vanished credential. A record
     * that never had one sailed through — which is exactly the shape the
     * development seed wrote, and why Google showed as connected on a fresh
     * launch with no sign-in. The tools follow the connection, so those 16
     * Google tools were in every planner prompt too, ready to be called
     * against an account that does not exist.
     */
    const credential = connection.credentialReference
      ? await credentialVault.get(connection.credentialReference)
      : null;

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
      /*
       * No seeded accounts, in either mode.
       *
       * Development used to write eleven fixture connections marked
       * `connected` with no credentials behind any of them, so a fresh
       * install showed Google as signed in before the user had done
       * anything — and `toolsForConnections`, which follows the connection
       * record, put all sixteen Google tools in the planner's prompt.
       *
       * Eight of those fixtures name connectors this branch no longer
       * registers at all, so they were orphaned records claiming accounts
       * nothing could serve. Same reason the catalogue and the registry were
       * cut: a build must not claim what it cannot honour, and a development
       * build is what runs on a phone during a demo.
       *
       * The removal runs every launch, not once, so a device already carrying
       * the fixtures is cleaned the next time it starts.
       */
      await removeDevelopmentConnections(connectionStore);
      await reconcileConnectionCredentials(
        connectionStore,
        getCredentialVault(),
      );

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
