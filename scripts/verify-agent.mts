/**
 * End-to-end tests of the agent orchestration loop:
 * planner → MCP → policy → approval → connector → tool result → planner.
 *
 * Runs against the real MCP runtime (in-process client/server) with the
 * deterministic mock TDLib adapter — no network, no real Telegram account.
 *
 * Run: npm run verify:agent
 */
import {
  InMemoryApprovalService,
  type ApprovalService,
} from '@mobile-agent/approval-core';
import {
  InMemoryConnectionStore,
  type ConnectionRecord,
} from '@mobile-agent/connector-core';
import { ConnectorRegistry } from '@mobile-agent/connector-registry';
import { DefaultPolicyEngine } from '@mobile-agent/policy-core';
import {
  createLocalMcpRuntime,
  type LocalMcpRuntime,
} from '@mobile-agent/mcp-client';
import {
  MockTdlibAdapter,
  TelegramUserConnector,
  TELEGRAM_USER_SCOPES,
} from '@mobile-agent/connector-telegram';

import { AgentRuntime } from '../src/agent/AgentRuntime.js';
import {
  createDeterministicPlanner,
  createScriptedPlanner,
} from '../src/agent/models/deterministicPlanner.js';
import {
  createRemoteAgentModel,
} from '../src/agent/models/remoteAgentModel.js';
import {
  MAX_AGENT_STEPS,
  type AgentMessage,
  type AgentModel,
  type AgentModelInput,
  type AgentModelResult,
  type AgentRunState,
  type AgentToolResult,
} from '../src/agent/types.js';
import type {
  RoutingTelemetry,
} from '../src/agent/routing/types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

/**
 * Read through a function so `asserts`-style narrowing cannot pin the array
 * length to a stale value across awaits.
 */
function sentCount(adapter: MockTdlibAdapter): number {
  return adapter.sentMessages.length;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMessage: string,
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`FAIL: timed out — ${timeoutMessage}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const TELEGRAM_CONNECTION_ID = 'telegram-user-test';

interface Harness {
  runtime: LocalMcpRuntime;
  adapter: MockTdlibAdapter;
  store: InMemoryConnectionStore;
  approvalService: ApprovalService;
}

async function createHarness(): Promise<Harness> {
  const store = new InMemoryConnectionStore();
  const now = Date.now();
  await store.save({
    id: TELEGRAM_CONNECTION_ID,
    connectorId: 'telegram-user',
    externalAccountId: '70000000',
    displayName: 'Test User',
    status: 'connected',
    scopes: [...TELEGRAM_USER_SCOPES],
    capabilities: [...TELEGRAM_USER_SCOPES],
    credentialReference: 'tdlib-session:test',
    createdAt: now,
    updatedAt: now,
  } satisfies ConnectionRecord);

  const adapter = new MockTdlibAdapter();
  adapter.restoreDevSession();

  const registry = new ConnectorRegistry({ allowDevelopmentMocks: true });
  registry.register(
    new TelegramUserConnector({
      store,
      adapterFactory: () => adapter,
    }),
  );

  const approvalService = new InMemoryApprovalService();

  const runtime = await createLocalMcpRuntime(
    {
      calendar: {
        async listEvents() {
          return [];
        },
        async createEvent() {
          throw new Error('not used in agent tests');
        },
      },
      approvals: {
        async assertApproved() {
          throw new Error('not used in agent tests');
        },
      },
    },
    {
      registry,
      policyEngine: new DefaultPolicyEngine(),
      approvalService,
    },
    { builtInCalendar: false },
  );

  return { runtime, adapter, store, approvalService };
}

interface AgentHarness {
  agent: AgentRuntime;
  states: AgentRunState[];
}

function createAgent(
  harness: Harness,
  plan: (input: AgentModelInput) => AgentModelResult | Promise<AgentModelResult>,
  maxSteps?: number,
): AgentHarness {
  const states: AgentRunState[] = [];

  const agent = new AgentRuntime({
    model: createScriptedPlanner(plan),
    mcp: harness.runtime.mcp,
    // The same capability context the app builds from its connection store.
    connections: toConnectionSummariesSync(harness),
    maxSteps,
    // Approve through the very service the MCP server consults — the
    // production wiring does the same via the runtime singleton.
    approveApproval: (id) => harness.approvalService.approve(id),
    onState: (state) => states.push(state),
  });

  return { agent, states };
}

function createAgentWithModel(
  harness: Harness,
  model: AgentModel,
  onRoutingTelemetry?: (telemetry: RoutingTelemetry) => void,
): AgentRuntime {
  return new AgentRuntime({
    model,
    mcp: harness.runtime.mcp,
    connections: toConnectionSummariesSync(harness),
    approveApproval: (id) => harness.approvalService.approve(id),
    onRoutingTelemetry,
  });
}

function toConnectionSummariesSync(harness: Harness) {
  return [
    {
      id: TELEGRAM_CONNECTION_ID,
      provider: 'telegram-user' as const,
      displayName: 'Test User',
      capabilities: [...TELEGRAM_USER_SCOPES],
    },
  ];
}

interface ToolHistoryEntry {
  toolName: string;
  result: AgentToolResult;
}

function toolResultsSinceUser(
  messages: readonly AgentMessage[],
): ToolHistoryEntry[] {
  const out: ToolHistoryEntry[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user') break;
    if (message.role === 'tool') {
      out.unshift({ toolName: message.toolName, result: message.result });
    }
  }
  return out;
}

function searchCall(id: string, query: string): AgentModelResult {
  return {
    kind: 'tool_calls',
    toolCalls: [
      {
        id,
        toolName: 'telegram.user.search_chats',
        args: { connectionId: TELEGRAM_CONNECTION_ID, query },
      },
    ],
  };
}

async function main(): Promise<void> {
  console.log('agent loop: read-only tool');
  {
    const harness = await createHarness();
    let plannerSawToolResult = false;

    const { agent } = createAgent(harness, (input) => {
      const history = toolResultsSinceUser(input.messages);
      const search = history.find(
        (entry) => entry.toolName === 'telegram.user.search_chats',
      );
      if (!search) return searchCall('c1', 'Данияр');
      plannerSawToolResult = search.result.status === 'success';
      return { kind: 'final', text: 'Нашёл чат Данияра.' };
    });

    await agent.sendMessage('Найди чат Данияра', 'test');

    assert(plannerSawToolResult, 'tool result returned to the planner');

    const messages = agent.getMessages();
    assert(
      messages.some((message) => message.role === 'tool'),
      'tool result stays in conversation state',
    );
    assert(
      messages.some(
        (message) =>
          message.role === 'assistant' &&
          message.content === 'Нашёл чат Данияра.',
      ),
      'final answer produced',
    );
    assert(
      !messages.some(
        (message) =>
          message.role === 'tool' &&
          message.result.status === 'approval_required',
      ),
      'read-only tool executed without approval',
    );

    await harness.runtime.close();
  }

  console.log('agent loop: side effect with approval');
  {
    const harness = await createHarness();

    const { agent } = createAgent(harness, (input) => {
      const history = toolResultsSinceUser(input.messages);
      const search = history.find(
        (entry) => entry.toolName === 'telegram.user.search_chats',
      );
      const send = history.find(
        (entry) => entry.toolName === 'telegram.user.send_message',
      );

      if (!search) return searchCall('c1', 'Данияр');

      if (!send) {
        const data = search.result.data as {
          chats: Array<{ id: string; title: string }>;
        };
        return {
          kind: 'tool_calls',
          toolCalls: [
            {
              id: 'c2',
              toolName: 'telegram.user.send_message',
              args: {
                connectionId: TELEGRAM_CONNECTION_ID,
                chatId: data.chats[0].id,
                chatTitle: data.chats[0].title,
                text: 'Привет',
              },
            },
          ],
        };
      }

      return send.result.status === 'success'
        ? { kind: 'final', text: 'Готово — отправил.' }
        : { kind: 'final', text: 'Не отправил.' };
    });

    const run = agent.sendMessage('Напиши Данияру привет', 'test');

    await waitFor(
      () => agent.getRunState().type === 'awaiting_approval',
      'run should pause on approval_required',
    );

    const approval = agent.getPendingApproval();
    assert(Boolean(approval), 'pending approval surfaced to the UI');
    assert(
      approval?.toolName === 'telegram.user.send_message',
      'approval names the gated tool',
    );
    assert(
      approval?.args.text === 'Привет',
      'approval carries the exact payload',
    );
    assert(
      sentCount(harness.adapter) === 0,
      'nothing is sent before the user confirms',
    );

    await agent.approvePendingApproval();
    await run;

    assert(
      sentCount(harness.adapter) === 1,
      'approved payload executes exactly once',
    );
    assert(
      harness.adapter.sentMessages[0].text === 'Привет',
      'the sent text matches the approved payload',
    );

    const messages = agent.getMessages();
    const last = messages[messages.length - 1];
    assert(
      last.role === 'assistant' && last.content === 'Готово — отправил.',
      'assistant confirms success after the tool result',
    );

    await harness.runtime.close();
  }

  console.log('agent loop: user rejects the approval');
  {
    const harness = await createHarness();

    const { agent } = createAgent(harness, (input) => {
      const history = toolResultsSinceUser(input.messages);
      const send = history.find(
        (entry) => entry.toolName === 'telegram.user.send_message',
      );

      if (!send) {
        return {
          kind: 'tool_calls',
          toolCalls: [
            {
              id: 'c1',
              toolName: 'telegram.user.send_message',
              args: {
                connectionId: TELEGRAM_CONNECTION_ID,
                chatId: 'mock-chat-даниар',
                text: 'Привет',
              },
            },
          ],
        };
      }

      return send.result.status === 'user_denied'
        ? { kind: 'final', text: 'Отменено — ничего не отправил.' }
        : { kind: 'final', text: 'Unexpected outcome' };
    });

    const run = agent.sendMessage('Напиши Данияру привет', 'test');

    await waitFor(
      () => agent.getRunState().type === 'awaiting_approval',
      'run should pause on approval_required',
    );

    await agent.rejectPendingApproval();
    await run;

    assert(
      sentCount(harness.adapter) === 0,
      'rejecting executes nothing',
    );

    const messages = agent.getMessages();
    assert(
      messages.some(
        (message) =>
          message.role === 'tool' && message.result.status === 'user_denied',
      ),
      'model receives a user_denied tool result',
    );
    const last = messages[messages.length - 1];
    assert(
      last.role === 'assistant' &&
        last.content === 'Отменено — ничего не отправил.',
      'assistant honestly reports the cancellation',
    );

    await harness.runtime.close();
  }

  console.log('agent loop: tool error returns to the model');
  {
    const harness = await createHarness();

    const { agent } = createAgent(harness, (input) => {
      const history = toolResultsSinceUser(input.messages);
      const send = history.find(
        (entry) => entry.toolName === 'telegram.user.send_message',
      );

      if (!send) {
        return {
          kind: 'tool_calls',
          toolCalls: [
            {
              id: 'c1',
              toolName: 'telegram.user.send_message',
              args: {
                connectionId: TELEGRAM_CONNECTION_ID,
                chatId: 'mock-chat-fail',
                text: 'Привет',
              },
            },
          ],
        };
      }

      return send.result.status === 'error'
        ? { kind: 'final', text: `Не вышло: ${send.result.error}` }
        : { kind: 'final', text: 'Отправил!' };
    });

    const run = agent.sendMessage('Напиши в чат fail', 'test');

    // send_message is gated: approve first, then the connector fails.
    await waitFor(
      () => agent.getRunState().type === 'awaiting_approval',
      'run should pause on approval_required',
    );
    await agent.approvePendingApproval();
    await run;

    assert(
      sentCount(harness.adapter) === 0,
      'failed tool sent nothing',
    );

    const messages = agent.getMessages();
    const last = messages[messages.length - 1];
    assert(
      last.role === 'assistant' &&
        last.content.startsWith('Не вышло:') &&
        !last.content.includes('Отправил!'),
      'assistant does not claim success after a tool error',
    );

    await harness.runtime.close();
  }

  console.log('agent loop: broken planner cannot exceed MAX_AGENT_STEPS');
  {
    const harness = await createHarness();
    let plannerCalls = 0;

    const { agent, states } = createAgent(
      harness,
      () => {
        plannerCalls += 1;
        return searchCall(`c${plannerCalls}`, 'Данияр');
      },
      MAX_AGENT_STEPS,
    );

    await agent.sendMessage('Зацикли меня', 'test');

    assert(
      plannerCalls <= MAX_AGENT_STEPS,
      `planner ran at most ${MAX_AGENT_STEPS} steps (ran ${plannerCalls})`,
    );

    const failed = states.find((state) => state.type === 'failed');
    assert(
      failed !== undefined &&
        failed.type === 'failed' &&
        failed.error.code === 'MAX_STEPS_EXCEEDED',
      'run fails with MAX_STEPS_EXCEEDED',
    );

    await harness.runtime.close();
  }

  console.log('agent loop: cancellation stops the run');
  {
    const harness = await createHarness();
    let releasePlanner: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releasePlanner = resolve;
    });

    const { agent } = createAgent(harness, async (input) => {
      if (toolResultsSinceUser(input.messages).length === 0) {
        // Stall the first planning step until the test cancels it.
        await gate;
        if (input.signal?.aborted) throw new Error('aborted');
      }
      return { kind: 'final', text: 'should never appear' };
    });

    const run = agent.sendMessage('Напиши Данияру привет', 'test');

    await waitFor(
      () => agent.getRunState().type === 'thinking',
      'run should start thinking',
    );

    agent.cancel();
    releasePlanner?.();
    await run;

    assert(
      agent.getRunState().type === 'idle',
      'cancelled run returns to idle without an answer',
    );
    assert(
      !agent
        .getMessages()
        .some(
          (message) =>
            message.role === 'assistant' &&
            message.content === 'should never appear',
        ),
      'no fabricated answer after cancellation',
    );

    await harness.runtime.close();
  }

  console.log('vertical slice: deterministic planner, real approval flow');
  {
    const harness = await createHarness();

    const agent = new AgentRuntime({
      model: createDeterministicPlanner(),
      mcp: harness.runtime.mcp,
      connections: [
        {
          id: TELEGRAM_CONNECTION_ID,
          provider: 'telegram-user',
          displayName: 'Test User',
          capabilities: [...TELEGRAM_USER_SCOPES],
        },
      ],
      approveApproval: (id) => harness.approvalService.approve(id),
    });

    const run = agent.sendMessage(
      'Напиши Данияру в Telegram, что буду через 20 минут',
      'test',
    );

    await waitFor(
      () => agent.getRunState().type === 'awaiting_approval',
      'the vertical slice should reach the approval gate',
    );

    const approval = agent.getPendingApproval();
    assert(
      approval?.toolName === 'telegram.user.send_message',
      'the send tool is gated',
    );
    assert(
      approval?.args.text === 'буду через 20 минут',
      'approval preview carries the exact message',
    );
    assert(
      typeof approval?.args.chatId === 'string' &&
        (approval.args.chatId as string).length > 0,
      'the planner resolved a chat id by name before sending',
    );
    assert(
      sentCount(harness.adapter) === 0,
      'nothing is sent before confirmation',
    );

    await agent.approvePendingApproval();
    await run;

    assert(
      sentCount(harness.adapter) === 1,
      'the approved message is sent exactly once',
    );
    assert(
      harness.adapter.sentMessages[0].text === 'буду через 20 минут',
      'Telegram receives exactly the approved text',
    );

    const messages = agent.getMessages();
    const last = messages[messages.length - 1];
    assert(
      last.role === 'assistant' && /готово/iu.test(last.content),
      'the assistant reports success',
    );

    await harness.runtime.close();
  }

  console.log('remote agent loop: backend → MCP → backend');
  {
    const harness = await createHarness();
    const requests: Array<Record<string, unknown>> = [];
    const originalFetch = globalThis.fetch;
    let telemetry: RoutingTelemetry | undefined;

    try {
      globalThis.fetch = (async (_url, init) => {
        const body = JSON.parse((init?.body as string) ?? '{}');
        requests.push(body);

        if (requests.length === 1) {
          return new Response(
            JSON.stringify({
              requestId: body.requestId,
              runId: body.runId,
              requestedModelTier: 'fast',
              effectiveModelTier: 'fast',
              routingReason: 'default_fast',
              result: {
                kind: 'tool_calls',
                text: null,
                toolCalls: [
                  {
                    id: 'remote_call_1',
                    toolName: 'telegram.user.search_chats',
                    args: {
                      connectionId: TELEGRAM_CONNECTION_ID,
                      query: 'Данияр',
                    },
                  },
                ],
              },
              usage: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (requests.length === 2) {
          const toolMessage = (body.messages as Array<Record<string, unknown>>).find(
            (message) => message.role === 'tool',
          ) as Record<string, unknown> | undefined;

          assert(
            toolMessage != null,
            'second request contains tool result',
          );

          assert(
            (toolMessage.result as Record<string, unknown>)?.status === 'success',
            'local MCP result reached remote model',
          );

          return new Response(
            JSON.stringify({
              requestId: body.requestId,
              runId: body.runId,
              requestedModelTier: 'fast',
              effectiveModelTier: 'fast',
              routingReason: 'default_fast',
              result: {
                kind: 'final',
                text: 'Нашёл чат Данияра.',
              },
              usage: {
                promptTokens: 20,
                completionTokens: 10,
                totalTokens: 30,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        throw new Error('unexpected third remote call');
      }) as typeof globalThis.fetch;

      const model = createRemoteAgentModel({
        baseUrl: 'http://fake-backend',
      });

      const agent = createAgentWithModel(harness, model, (value) => {
        telemetry = value;
      });

      await agent.sendMessage('Найди Данияра в Telegram');

      assertEq(requests.length, 2, 'remote model called twice');
      assertEq(requests[0].runId, requests[1].runId, 'same runId across model steps');
      assert(
        (requests[0].connections as Array<unknown>)?.length === 1,
        'connections sent to backend',
      );

      const tools = requests[0].tools as Array<Record<string, unknown>>;
      assert(
        tools?.some((tool) => tool.name === 'telegram.user.search_chats'),
        'MCP tool schema sent to backend',
      );

      const messages = agent.getMessages();
      const final = messages[messages.length - 1];

      assert(
        final.role === 'assistant' && final.content === 'Нашёл чат Данияра.',
        'remote final answer reaches conversation',
      );

      assert(
        telemetry?.completedSuccessfully === true,
        'run completed successfully',
      );

      assertEq(telemetry?.totalToolCalls, 1, 'one local tool call executed');
      assertEq(telemetry?.fastCalls, 2, 'two effective FAST calls recorded');

      assertEq(telemetry?.promptTokens, 30, 'prompt token usage aggregated');
      assertEq(telemetry?.completionTokens, 15, 'completion usage aggregated');
      assertEq(telemetry?.totalTokens, 45, 'total token usage aggregated');
    } finally {
      globalThis.fetch = originalFetch;
      await harness.runtime.close();
    }
  }

  console.log('verify:agent — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
