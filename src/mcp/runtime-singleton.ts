import {
  InMemoryApprovalStore,
  MockCalendarConnector,
} from '@mobile-agent/connector-mock';
import { InMemoryApprovalService } from '@mobile-agent/approval-core';
import { DefaultPolicyEngine } from '@mobile-agent/policy-core';
import {
  InMemoryConnectionStore,
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
import { ensureDeviceConnection, removeDevelopmentConnections } from './dev-seed';
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
// Seeding is a once-per-session bootstrap: a runtime restart (e.g. after a
// disconnect) must not resurrect a connection the user just removed.

/**
 * The app registers its real dependencies (persistent ConnectionStore,
 * Keystore-backed CredentialVault) at startup. Verification scripts and
 * other non-app contexts simply never call this and get in-memory fallbacks.
 */
export function configureAppDependencies(deps: AppMcpDependencies): void {
  appDependencies = deps;
}

/**
 * The single source of truth for connection state. UI, ConnectionService,
 * MCP tool registration and connector auth flows all read/write this store —
 * there is never one connection state in the UI and another in MCP.
 */
export function getConnectionStore(): ConnectionStore {
  if (appDependencies) return appDependencies.connectionStore;
  if (!fallbackStore) fallbackStore = new InMemoryConnectionStore();
  return fallbackStore;
}

/**
 * Marks connected-but-credential-less connections as `reconnect_required` so
 * their tools are never exposed. A connection can claim `connected` while its
 * credential has vanished (web reload with an in-memory vault, SecureStore
 * reset, partial restore, migration) — reconciliation turns that into an
 * honest state instead of a tool that 401s at call time.
 */
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

/**
 * Secrets live only in the vault. Connection records carry a
 * `credentialReference` pointing here — never the credential itself.
 */
export function getCredentialVault(): CredentialVault {
  if (appDependencies) return appDependencies.credentialVault;
  if (!fallbackVault) fallbackVault = new InMemoryCredentialVault();
  return fallbackVault;
}

export interface GetRuntimeOptions {
  /** First call wins; later calls reuse the singleton's mode. */
  mode?: McpRuntimeMode;
}

/**
 * Синглтон локального MCP runtime.
 *
 * Client и server живут в одном JS-процессе
 * и соединены через InMemoryTransport.
 * Runtime создаётся один раз на сессию приложения
 * и не пересоздаётся при React re-render.
 *
 * Режим решает, что видит модель:
 * - development — mock-подключения и встроенный
 *   mock-календарь (демо и тесты);
 * - production — только реальные коннекторы и ни
 *   одного mock-аккаунта.
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
       * The same connection state in both modes. Development used to
       * pre-connect every service, so a fresh install claimed a dozen accounts
       * were linked when none were; the cleanup runs here rather than only in
       * production because those rows are already on disk for anyone who ran
       * such a build, and they are wrong in either mode.
       */
      await removeDevelopmentConnections(connectionStore);
      await ensureDeviceConnection(connectionStore);

      // A persistent connection whose credential has vanished must not keep
      // claiming `connected` — reconcile before the registry reads it.
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
        // Разрешаем повторную инициализацию,
        // если первый запуск завершился ошибкой.
        runtimePromise = null;
        runtimeMode = null;
        currentRegistry = null;
        throw error;
      });
  }

  return runtimePromise;
}

/** Mode the singleton was created with (diagnostics). */
export function getRuntimeMode(): McpRuntimeMode | null {
  return runtimeMode;
}

/**
 * The registry backing the live runtime, if initialized. ConnectionService
 * uses it so connect/disconnect act on the same connector instances that
 * serve the model's tools.
 */
export function getCurrentRegistry(): ConnectorRegistry | null {
  return currentRegistry;
}

/**
 * The ids actually registered in this build's runtime. The UI uses this to
 * decide whether a catalogue tile is really connectable — a mock connector
 * omitted from a production registry must not be offered as available.
 */
export async function getRegisteredConnectorIds(): Promise<Set<string>> {
  await getLocalMcpRuntime();
  const registry = getCurrentRegistry();
  if (!registry) return new Set();
  return new Set(registry.listConnectors().map((connector) => connector.id));
}

/**
 * Rebuilds the runtime so newly connected/disconnected accounts change the
 * tool list. ConnectionService calls this after every connect/disconnect.
 */
export async function restartLocalMcpRuntime(): Promise<LocalMcpRuntime> {
  const mode = runtimeMode;
  await closeLocalMcpRuntime();
  return getLocalMcpRuntime(mode ? { mode } : {});
}

/**
 * Выдаёт одноразовый approval для встроенных
 * calendar-инструментов.
 *
 * В реальном приложении вызывается UI-слоем
 * после явного подтверждения пользователя.
 */
export function issueToolApproval(input: {
  toolName: string;
  payload: Record<string, unknown>;
}): string {
  if (!approvalStore) {
    throw new Error('MCP runtime is not initialized');
  }

  return approvalStore.issue(input);
}

/**
 * Подтверждает approval, выданный connector-инструментом.
 *
 * Connector tools возвращают `status: "approval_required"`
 * вместе с `approvalId`. UI показывает preview, и после
 * согласия пользователя вызывает эту функцию — только
 * после этого повторный вызов инструмента с тем же
 * `approvalId` будет выполнен.
 *
 * This function is UI-only. The model has no tool that approves actions —
 * an LLM can never approve its own side effect.
 */
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
    // A close failure must never strand the singleton on a stale runtime:
    // clearing these lets the next getLocalMcpRuntime()/restart rebuild clean.
    runtimePromise = null;
    runtimeMode = null;
    currentRegistry = null;
    approvalStore = null;
    approvalService = null;
  }
}
