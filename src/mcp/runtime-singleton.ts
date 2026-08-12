import {
  InMemoryApprovalStore,
  MockCalendarConnector,
} from '@mobile-agent/connector-mock';
import { InMemoryApprovalService } from '@mobile-agent/approval-core';
import { DefaultPolicyEngine } from '@mobile-agent/policy-core';
import {
  InMemoryConnectionStore,
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
// Seeding is a once-per-session bootstrap: a runtime restart (e.g. after a
// disconnect) must not resurrect a connection the user just removed.
let devConnectionsSeeded = false;

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
      if (mode === 'production') {
        await removeDevelopmentConnections(connectionStore);
      } else if (!devConnectionsSeeded) {
        const telegramMode = resolveTelegramAdapterMode(mode);
        await seedDevelopmentConnections(connectionStore, {
          skipTelegramSeed: telegramMode === 'native',
        });
        // Also clean up any leftover mock Telegram record from a previous
        // run with a different adapter mode.
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

  if (currentRegistry) {
    for (const connector of currentRegistry.listConnectors()) {
      const disposable = (connector as { dispose?: () => Promise<void> }).dispose;
      if (disposable) {
        try { await disposable(); } catch { /* best-effort */ }
      }
    }
  }

  await runtime.close();

  runtimePromise = null;
  currentRegistry = null;
  approvalStore = null;
  approvalService = null;
}
