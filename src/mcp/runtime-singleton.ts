import {
  InMemoryApprovalStore,
  MockCalendarConnector,
} from '@mobile-agent/connector-mock';
import {
  createLocalMcpRuntime,
  type LocalMcpRuntime,
} from '@mobile-agent/mcp-client';

let runtimePromise: Promise<LocalMcpRuntime> | null = null;
let approvalStore: InMemoryApprovalStore | null = null;

/**
 * Singleton локального MCP runtime.
 *
 * Client и server живут в одном JS-процессе
 * и соединены через InMemoryTransport.
 * Runtime создаётся один раз на сессию приложения
 * и не пересоздаётся при React re-render.
 */
export function getLocalMcpRuntime(): Promise<LocalMcpRuntime> {
  if (!runtimePromise) {
    const store = new InMemoryApprovalStore();

    runtimePromise = createLocalMcpRuntime({
      calendar: new MockCalendarConnector(),
      approvals: store,
    })
      .then((runtime) => {
        approvalStore = store;
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
 * Выдаёт одноразовый approval для write-операций.
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

export async function closeLocalMcpRuntime(): Promise<void> {
  if (!runtimePromise) {
    return;
  }

  const runtime = await runtimePromise;

  await runtime.close();

  runtimePromise = null;
  approvalStore = null;
}
