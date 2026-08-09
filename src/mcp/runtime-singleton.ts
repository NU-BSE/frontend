import {
  InMemoryApprovalStore,
  MockCalendarConnector,
} from '@mobile-agent/connector-mock';
import { InMemoryApprovalService } from '@mobile-agent/approval-core';
import { DefaultPolicyEngine } from '@mobile-agent/policy-core';
import {
  createLocalMcpRuntime,
  type LocalMcpRuntime,
} from '@mobile-agent/mcp-client';

import { createConnectorRegistry } from './create-connector-registry';

let runtimePromise: Promise<LocalMcpRuntime> | null = null;
let approvalStore: InMemoryApprovalStore | null = null;
let approvalService: InMemoryApprovalService | null = null;

/**
 * Синглтон локального MCP runtime.
 *
 * Client и server живут в одном JS-процессе
 * и соединены через InMemoryTransport.
 * Runtime создаётся один раз на сессию приложения
 * и не пересоздаётся при React re-render.
 *
 * Сервер отдаёт инструменты из двух источников:
 * встроенные (`system.health`, calendar) и все
 * подключённые connectors из registry.
 */
export function getLocalMcpRuntime(): Promise<LocalMcpRuntime> {
  if (!runtimePromise) {
    const store = new InMemoryApprovalStore();
    const service = new InMemoryApprovalService();

    runtimePromise = createLocalMcpRuntime(
      {
        calendar: new MockCalendarConnector(),
        approvals: store,
      },
      {
        registry: createConnectorRegistry(),
        policyEngine: new DefaultPolicyEngine(),
        approvalService: service,
      },
    )
      .then((runtime) => {
        approvalStore = store;
        approvalService = service;
        return runtime;
      })
      .catch((error) => {
        // Разрешаем повторную инициализацию,
        // если первый запуск завершился ошибкой.
        runtimePromise = null;
        throw error;
      });
  }

  return runtimePromise;
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

  await runtime.close();

  runtimePromise = null;
  approvalStore = null;
  approvalService = null;
}
