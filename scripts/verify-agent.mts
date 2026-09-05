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
  StoreBackedConnector,
  type ConnectionRecord,
  type ConnectorTool,
} from '@mobile-agent/connector-core';
import { ConnectorRegistry } from '@mobile-agent/connector-registry';
import { DefaultPolicyEngine } from '@mobile-agent/policy-core';
import * as z from 'zod/v4';
import {
  createLocalMcpRuntime,
  type LocalMcpRuntime,
} from '@mobile-agent/mcp-client';
import {
  MockTdlibAdapter,
  TelegramUserConnector,
  TELEGRAM_USER_SCOPES,
} from '@mobile-agent/connector-telegram';

import { AgentRuntime, toolsForConnections } from '../src/agent/AgentRuntime.js';
import {
  SCOPE_REMEDIES,
  classifyToolError,
  executeToolCall,
  resolveConnectionIds,
} from '../src/agent/toolExecutor.js';
import { OPEN_SCREENS } from '@mobile-agent/connector-android';
import type { ForegroundGate } from '../src/agent/foregroundGate.js';
import { ToolExecutionLedger } from '../src/agent/toolExecutionLedger.js';
import { mapMcpTools } from '../src/agent/toolMapper.js';
import { createStructuredPlanner } from '../src/agent/models/structuredPlanner.js';
import type { LlmEngine } from '../src/ai/types.js';
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

/**
 * Test double that records the exact `input` the MCP server hands to
 * `tool.execute`, so a test can prove `approvalId` never reaches the
 * connector.
 */
class SpySendConnector extends StoreBackedConnector {
  readonly id = 'telegram-user' as const;
  readonly displayName = 'Spy Telegram';
  readonly implementationStatus = 'mock' as const;
  readonly receivedInputs: Record<string, unknown>[] = [];

  constructor(store: InMemoryConnectionStore) {
    super({ store });
  }

  async getTools(): Promise<ConnectorTool<any, any>[]> {
    return [
      {
        name: 'telegram.user.send_message',
        title: 'Send message',
        description: 'Send a message (spy)',
        inputSchema: z.object({
          connectionId: z.string(),
          chatId: z.string(),
          text: z.string(),
        }),
        risk: 'external_side_effect',
        capabilities: [],
        requiredScopes: [],
        implementationStatus: 'development_mock',
        execute: async (input: Record<string, unknown>) => {
          this.receivedInputs.push(input);
          return { status: 'sent' };
        },
      },
    ];
  }
}

async function createSpyHarness(): Promise<{
  runtime: LocalMcpRuntime;
  spy: SpySendConnector;
  approvalService: ApprovalService;
}> {
  const store = new InMemoryConnectionStore();
  const now = Date.now();
  await store.save({
    id: TELEGRAM_CONNECTION_ID,
    connectorId: 'telegram-user',
    externalAccountId: '70000000',
    displayName: 'Test User',
    status: 'connected',
    scopes: ['telegram.messages.send'],
    capabilities: ['telegram.messages.send'],
    credentialReference: 'tdlib-session:test',
    createdAt: now,
    updatedAt: now,
  } satisfies ConnectionRecord);

  const spy = new SpySendConnector(store);
  const registry = new ConnectorRegistry({ allowDevelopmentMocks: true });
  registry.register(spy);

  const approvalService = new InMemoryApprovalService();
  const runtime = await createLocalMcpRuntime(
    {
      calendar: {
        async listEvents() {
          return [];
        },
        async createEvent() {
          throw new Error('not used');
        },
      },
      approvals: {
        async assertApproved() {
          throw new Error('not used');
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

  return { runtime, spy, approvalService };
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
                chatId: '123456789',
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
                chatId: '-1',
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
  const calls = () => plannerCalls;

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

  console.log('approval: model-visible schema hides approvalId');
  {
    const harness = await createHarness();
    const allTools = await harness.runtime.mcp.listTools();

    const rawSend = allTools.find(
      (tool) => tool.name === 'telegram.user.send_message',
    );
    assert(rawSend !== undefined, 'send_message is registered');
    assert(
      Boolean(
        (rawSend.inputSchema as { properties?: Record<string, unknown> })
          .properties?.approvalId,
      ),
      'the raw MCP schema still accepts approvalId internally',
    );

    const mapped = mapMcpTools(allTools);
    const mappedSend = mapped.find(
      (tool) => tool.name === 'telegram.user.send_message',
    );
    const props = mappedSend?.inputSchema.properties as
      | Record<string, unknown>
      | undefined;
    assert(
      props?.approvalId === undefined,
      'the model-visible schema hides approvalId',
    );

    await harness.runtime.close();
  }

  console.log('approval: malicious model approvalId is ignored');
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
                chatId: '123456789',
                text: 'Привет',
                approvalId: 'fake-approval',
              },
            },
          ],
        };
      }

      return send.result.status === 'success'
        ? { kind: 'final', text: 'Отправил.' }
        : { kind: 'final', text: 'Не отправил.' };
    });

    const run = agent.sendMessage('Отправь сообщение', 'test');

    // A model-supplied approvalId must be ignored, not fed to consume().
    await waitFor(
      () => agent.getRunState().type === 'awaiting_approval',
      'a fake approvalId must still pause for real approval',
    );

    const approval = agent.getPendingApproval();
    assert(Boolean(approval), 'approval surfaced to the UI');
    assert(
      !('approvalId' in (approval?.args ?? {})),
      'the frozen approval payload excludes the fake approvalId',
    );
    assert(
      sentCount(harness.adapter) === 0,
      'nothing is sent before the user confirms',
    );

    await agent.approvePendingApproval();
    await run;

    assert(
      sentCount(harness.adapter) === 1,
      'the approved payload executes exactly once',
    );
    assert(
      harness.adapter.sentMessages[0].text === 'Привет',
      'the sent text matches the approved payload',
    );

    await harness.runtime.close();
  }

  console.log('approval: approvalId never reaches the connector');
  {
    const { runtime, spy, approvalService } = await createSpyHarness();

    const agent = new AgentRuntime({
      model: createScriptedPlanner((input) => {
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
                  chatId: 'spy-chat',
                  text: 'Привет',
                },
              },
            ],
          };
        }
        return { kind: 'final', text: 'Готово.' };
      }),
      mcp: runtime.mcp,
      connections: [
        {
          id: TELEGRAM_CONNECTION_ID,
          provider: 'telegram-user',
          displayName: 'Test User',
          capabilities: ['telegram.messages.send'],
        },
      ],
      approveApproval: (id) => approvalService.approve(id),
    });

    const run = agent.sendMessage('Отправь', 'test');
    await waitFor(
      () => agent.getRunState().type === 'awaiting_approval',
      'spy tool reaches the approval gate',
    );
    await agent.approvePendingApproval();
    await run;

    assert(
      spy.receivedInputs.length === 1,
      'the connector executed exactly once',
    );
    assert(
      !('approvalId' in spy.receivedInputs[0]),
      'the connector never receives approvalId',
    );
    assertEq(
      spy.receivedInputs[0].text,
      'Привет',
      'the connector received the exact payload',
    );

    await runtime.close();
  }

  
/*
 * Only tools that could run reach the prompt.
 *
 * The registry used to hold 103 tools across every connector; rendered into
 * the planner's system prompt that was about 7,000 tokens, and a local 2B with
 * a 4,096-token window cannot load it at all — llama.cpp refuses the prompt
 * with "Context is full" and the run ends having produced nothing. That is the
 * bug this filter exists for, and it is invisible until someone tries it on a
 * phone.
 *
 * Deleting the eight mock connectors since then took the registry to 22 tools
 * and ~900 tokens, which does most of the same work — but only for the
 * connectors that happen to be registered today. This filter is the part that
 * keeps holding as connectors are added back, because a tool for an account
 * that is not connected cannot succeed whatever the budget is.
 */
console.log('\ntools are limited to connected accounts:');
{
  const tools = [
    { name: 'google.gmail.send_draft', description: '', inputSchema: {} },
    { name: 'telegram.user.search_chats', description: '', inputSchema: {} },
    { name: 'microsoft.outlook.send_mail', description: '', inputSchema: {} },
    { name: 'calendar.create_event', description: '', inputSchema: {} },
    { name: 'system.health', description: '', inputSchema: {} },
  ] as never[];

  const connections = [
    { id: 'c1', provider: 'google', displayName: 'Google', capabilities: [] },
    // The suffix a connector may carry: this one serves the `telegram.*` tools.
    { id: 'c2', provider: 'telegram-user', displayName: 'Telegram', capabilities: [] },
  ];

  const kept = toolsForConnections(tools, connections).map((tool) => tool.name);

  assert(kept.includes('google.gmail.send_draft'), 'a connected account keeps its tools');
  assert(
    kept.includes('telegram.user.search_chats'),
    'a connector id with a suffix still matches its namespace',
  );
  assert(
    !kept.includes('microsoft.outlook.send_mail'),
    'an unconnected account contributes nothing — it could not run anyway',
  );
  assert(
    kept.includes('calendar.create_event'),
    'the built-in calendar survives, having no connection behind it',
  );
  assert(kept.includes('system.health'), 'and so does system.health');

  assert(
    toolsForConnections(tools, []).map((t) => t.name).join(',') ===
      'calendar.create_event,system.health',
    'with nothing connected, only the built-ins remain',
  );
}

/*
 * The structured planner's protocol, against the outputs a 2B actually
 * produces.
 *
 * The schema asks only that a `final`'s content be a non-empty string, and
 * that was enough to put a raw tool-call fragment in front of a user: "Open
 * Digital Assistant App setting and change it to Creepy" was answered with the
 * literal text `{"connectionId":"android-device"}`. The run reported
 * completedSuccessfully with zero tool calls, and the tool it needed
 * (android.assistant.open_settings) was available the whole time.
 *
 * The line to hold is between a model failing the protocol and a model
 * answering — including answering *about* JSON, which is legitimate.
 */
console.log('\nthe planner never shows protocol output as an answer:');
{
  function engineReturning(...replies: string[]): LlmEngine {
    let index = 0;
    return {
      id: 'stub-engine',
      label: 'stub',
      isReady: () => true,
      prepare: () => Promise.resolve(),
      // eslint-disable-next-line @typescript-eslint/require-await
      async *generate() {
        yield replies[Math.min(index, replies.length - 1)] ?? '';
        index += 1;
      },
    } as unknown as LlmEngine;
  }

  const plannerInput = {
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Open Digital Assistant App setting and change it to Creepy',
      },
    ],
    tools: [
      {
        name: 'android.assistant.open_settings',
        description: 'Open the assistant settings screen.',
        inputSchema: { properties: { connectionId: { type: 'string' } } },
      },
    ],
    connections: [
      {
        id: 'android-device',
        provider: 'android',
        displayName: 'This device',
        capabilities: [],
      },
    ],
  } as never;

  async function plan(...replies: string[]) {
    return createStructuredPlanner(engineReturning(...replies)).run(plannerInput);
  }

  const DEGRADED = 'I could not form a valid plan for that request. Please rephrase.';

  // The exact completion behind the reported bug.
  const reported = await plan(
    '{"type":"final","content":"{\\"connectionId\\":\\"android-device\\"}"}',
  );
  assert(
    reported.kind === 'final' && reported.text === DEGRADED,
    'a final whose content is a bare JSON object is refused, not rendered',
  );

  const bare = await plan('{"connectionId":"android-device"}');
  assert(
    bare.kind === 'final' && bare.text === DEGRADED,
    'a bare arguments object is not mistaken for an answer',
  );

  const prose = await plan('Sure. {"connectionId":"android-device"}');
  assert(
    prose.kind === 'final' && prose.text === 'Sure.',
    'protocol debris is trimmed off the readable text beside it',
  );

  // Rejecting it as unparseable is what lets the correction retry work.
  const recovered = await plan(
    '{"type":"final","content":"{\\"connectionId\\":\\"android-device\\"}"}',
    '{"type":"tool_call","tool":"android.assistant.open_settings","arguments":{"connectionId":"android-device"}}',
  );
  assert(
    recovered.kind === 'tool_calls' &&
      recovered.toolCalls[0]?.toolName === 'android.assistant.open_settings',
    'the retry can still recover the tool call the model meant to make',
  );

  /*
   * The second failure from the same phone, and the reason this check cannot
   * simply require valid JSON. The model nested a tool call inside a stray
   * `"arguments"` key and broke the quoting (`{""assistant":`), so JSON.parse
   * throws — which is evidence of debris, not of prose.
   */
  const malformed = await plan(
    '{"type": "final", "content": "{\\"connectionId\\":\\"android-device\\",\\"arguments\\":{\\"\\"assistant\\":{\\"type\\":\\"tool_call\\",\\"tool\\":\\"android.assistant.request_role\\",\\"connectionId\\":\\"android-device\\"}"}',
  );
  assert(
    malformed.kind === 'final' && malformed.text === DEGRADED,
    'malformed protocol debris is refused too — being broken is not a defence',
  );

  const quoting = await plan(
    '{"type":"final","content":"The tool returned {\\"ok\\":true}, so it worked."}',
  );
  assert(
    quoting.kind === 'final' &&
      quoting.text === 'The tool returned {"ok":true}, so it worked.',
    'an answer that merely quotes JSON is left alone',
  );

  /*
   * An invented tool name gets the retry, not the user's screen.
   *
   * "Turn off Gemini app" was answered with "I wanted to use a tool named
   * android.settings.get_app_info, but it is not available. Available tools:
   * system.health, calendar.list_events, …" — the registry pasted into a chat
   * bubble. That text was written for the model and shown to the user, and the
   * model never got the second look that would have found the real name.
   */
  const recoveredName = await plan(
    '{"type":"tool_call","tool":"android.settings.get_app_info","arguments":{"connectionId":"android-device"}}',
    '{"type":"tool_call","tool":"android.assistant.open_settings","arguments":{"connectionId":"android-device"}}',
  );
  assert(
    recoveredName.kind === 'tool_calls' &&
      recoveredName.toolCalls[0]?.toolName === 'android.assistant.open_settings',
    'an invented tool name is retried and the real one is used',
  );

  const stillInvented = await plan(
    '{"type":"tool_call","tool":"android.settings.get_app_info","arguments":{}}',
  );
  assert(
    stillInvented.kind === 'final' &&
      !stillInvented.text.includes('android.assistant.open_settings'),
    'giving up does not paste the tool registry into the chat',
  );
  assert(
    stillInvented.kind === 'final' &&
      stillInvented.text === 'I do not have a way to do that on this device.',
    'the user gets a sentence about their request instead',
  );

  /*
   * And the retry is told which real names are near the invented one, not all
   * of them — the same list that was too long for a chat bubble is too long
   * for a 2B's prompt.
   */
  {
    const prompts: string[] = [];
    const recording: LlmEngine = {
      id: 'recording',
      label: 'recording',
      isReady: () => true,
      prepare: () => Promise.resolve(),
      // eslint-disable-next-line @typescript-eslint/require-await
      async *generate(turns: readonly { content: string }[]) {
        prompts.push(turns.map((turn) => turn.content).join('\n'));
        yield '{"type":"tool_call","tool":"android.settings.get_app_info","arguments":{}}';
      },
    } as unknown as LlmEngine;

    await createStructuredPlanner(recording).run({
      messages: [{ id: 'm1', role: 'user', content: 'turn off the Gemini app' }],
      // More tools than the hint will list, so trimming is observable. The
      // registry on the device holds 22.
      tools: [
        { name: 'android.apps.get_info', description: '', inputSchema: {} },
        { name: 'android.apps.find', description: '', inputSchema: {} },
        { name: 'android.settings.get_brightness', description: '', inputSchema: {} },
        { name: 'android.settings.set_brightness', description: '', inputSchema: {} },
        { name: 'android.settings.open', description: '', inputSchema: {} },
        { name: 'android.settings.open_app', description: '', inputSchema: {} },
        { name: 'android.settings.get_capabilities', description: '', inputSchema: {} },
        { name: 'android.settings.open_panel', description: '', inputSchema: {} },
        { name: 'android.assistant.get_status', description: '', inputSchema: {} },
        { name: 'telegram.user.send_message', description: '', inputSchema: {} },
        { name: 'telegram.user.search_chats', description: '', inputSchema: {} },
        { name: 'google.gmail.send_draft', description: '', inputSchema: {} },
        { name: 'calendar.create_event', description: '', inputSchema: {} },
        { name: 'system.health', description: '', inputSchema: {} },
      ],
      connections: [],
    } as never);

    // The correction only; the system prompt ahead of it lists every tool by
    // design, so asserting against the whole turn would prove nothing.
    const marker = 'There is no tool named';
    const retry = prompts[1] ?? '';
    const hint = retry.slice(retry.indexOf(marker));
    assert(
      hint.startsWith(`${marker} "android.settings.get_app_info"`),
      'the retry names the tool that does not exist',
    );
    assert(
      hint.includes('- android.apps.get_info'),
      'and offers the real name closest to it',
    );
    assert(
      !hint.includes('telegram.user.send_message') &&
        !hint.includes('google.gmail.send_draft'),
      'without dragging in tools from unrelated namespaces',
    );
    assert(
      hint.includes('- android.settings.open_app'),
      'and the door for "turn off an app" is among them',
    );
    assert(
      hint.split('\n').filter((line) => line.startsWith('- ')).length <= 8,
      'and the list stays short enough for a small model to read',
    );
  }

  /*
   * An enum argument is shown as its values, not as `string`.
   *
   * `android.settings.open_app` failed with "target: Invalid option" because
   * the prompt said `target: string` while the schema listed eight exact names
   * it never surfaced. The model was asked for a value it had never been
   * shown — the same mistake as making it transcribe a connectionId.
   */
  {
    const prompts: string[] = [];
    const recording: LlmEngine = {
      id: 'recording-enum',
      label: 'recording',
      isReady: () => true,
      prepare: () => Promise.resolve(),
      // eslint-disable-next-line @typescript-eslint/require-await
      async *generate(turns: readonly { content: string }[]) {
        prompts.push(turns[0]?.content ?? '');
        yield '{"type":"final","content":"ok"}';
      },
    } as unknown as LlmEngine;

    await createStructuredPlanner(recording).run({
      messages: [{ id: 'm1', role: 'user', content: 'turn off the Gemini app' }],
      tools: [
        {
          name: 'android.settings.open_app',
          description: 'Open app settings.',
          inputSchema: {
            properties: {
              connectionId: { type: 'string' },
              target: {
                type: 'string',
                enum: ['appDetails', 'appNotifications', 'appUsage'],
              },
              packageName: { type: 'string' },
              channelId: { type: 'string' },
            },
            required: ['connectionId', 'target', 'packageName'],
          },
        },
      ],
      connections: [],
    } as never);

    const system = prompts[0] ?? '';
    assert(
      system.includes('target: one of "appDetails"|"appNotifications"|"appUsage"'),
      'an enum argument is spelled out so the model can copy a valid value',
    );
    /*
     * open_app was called with connectionId and target and no packageName.
     * The schema's `required` list had it; the prompt rendered all four
     * arguments identically, so nothing said which could be left out.
     */
    assert(
      system.includes('packageName: string;') ||
        system.includes('packageName: string }'),
      'a required argument carries no marker',
    );
    assert(
      system.includes('channelId: string (optional)'),
      'and an optional one is marked, which is what says the others are not',
    );
    assert(
      system.includes(
        'Every argument listed for a tool is required unless marked (optional)',
      ),
      'with the rule that gives the marker its meaning stated in the protocol',
    );
    assert(
      !system.includes('target: string'),
      'and is not flattened to "string", which is what made it guess',
    );
    assert(
      system.includes('packageName: string'),
      'a non-enum argument is still described by its type',
    );
  }

  const plain = await plan(
    '{"type":"final","content":"Telegram is not connected."}',
  );
  assert(
    plain.kind === 'final' && plain.text === 'Telegram is not connected.',
    'an ordinary answer is unaffected',
  );

  // The boundary: braces alone are not enough to condemn an answer. Prose
  // wrapped in braces carries none of the protocol's vocabulary and does not
  // parse, so it survives.
  const braced = await plan(
    '{"type":"final","content":"{this is not json, it is a sentence}"}',
  );
  assert(
    braced.kind === 'final' &&
      braced.text === '{this is not json, it is a sentence}',
    'text in braces that is neither JSON nor protocol vocabulary is left alone',
  );
}

/*
 * A guessed connectionId is corrected only where there is nothing to choose.
 *
 * Every tool in a namespace is named for it, so `android` is the most
 * available string in the prompt and is what the local model sent —
 * CONNECTION_NOT_FOUND against an account called `android-device`, one
 * character of copying from working.
 */
console.log('\nan unmistakable connectionId is resolved, an ambiguous one is not:');
{
  const call = (toolName: string, args: Record<string, unknown>) =>
    ({ id: 'c', toolName, args }) as never;

  const android = {
    id: 'android-device',
    provider: 'android',
    displayName: 'This device',
    capabilities: [],
  };
  const telegram = {
    id: 'telegram-user-1',
    provider: 'telegram-user',
    displayName: 'Telegram',
    capabilities: [],
  };

  const idOf = (calls: readonly { args: Record<string, unknown> }[]) =>
    calls[0]?.args.connectionId;

  assert(
    idOf(
      resolveConnectionIds(
        [call('android.assistant.open_settings', { connectionId: 'android' })],
        [android],
      ),
    ) === 'android-device',
    'the namespace mistaken for an id is corrected to the only account',
  );

  assert(
    idOf(
      resolveConnectionIds(
        [call('telegram.user.search_chats', { connectionId: 'telegram' })],
        [android, telegram],
      ),
    ) === 'telegram-user-1',
    'a provider whose id carries a suffix still resolves',
  );

  // Correct input must survive untouched.
  const good = resolveConnectionIds(
    [call('android.assistant.open_settings', { connectionId: 'android-device' })],
    [android],
  );
  assert(idOf(good) === 'android-device', 'a correct id is left alone');

  // Two accounts of one provider is a real choice and not ours to make.
  const second = { ...android, id: 'android-device-2' };
  assert(
    idOf(
      resolveConnectionIds(
        [call('android.assistant.open_settings', { connectionId: 'android' })],
        [android, second],
      ),
    ) === 'android',
    'two accounts of one provider stay ambiguous — the error is the honest answer',
  );

  assert(
    idOf(
      resolveConnectionIds(
        [call('google.gmail.send_draft', { connectionId: 'google' })],
        [android],
      ),
    ) === 'google',
    'a namespace with no connected account is not resolved to some other one',
  );

  // Absent stays absent: whether a tool takes a connectionId is the schema's
  // business, and system.health would reject the extra field.
  const noneGiven = resolveConnectionIds([call('system.health', {})], [android]);
  assert(
    !('connectionId' in (noneGiven[0]?.args ?? {})),
    'a call with no connectionId does not acquire one',
  );

  // The correction must not disturb the rest of the payload.
  const other = resolveConnectionIds(
    [call('telegram.user.send_message', { connectionId: 'telegram', chatId: '5', text: 'hi' })],
    [telegram],
  );
  assert(
    other[0]?.args.chatId === '5' && other[0]?.args.text === 'hi',
    'the other arguments are carried through unchanged',
  );
}

/*
 * The agent does not act while the user is out of the app.
 *
 * `open_settings` is a tool whose whole effect is to put Android's Settings in
 * front of the user, and the run continued behind it:
 *
 *   android.assistant.request_role — done
 *   android.assistant.open_settings — done
 *   android.assistant.get_status — done
 *   Checking agent health — done
 *   android.assistant.open_settings — cancelled by you
 *   Checking agent health — done   (x3)
 *
 * It asked whether the role had been granted before the user had reached the
 * screen, and burned the rest of its step budget re-asking. Polling a state
 * the user is mid-way through changing has no true answer, so the loop holds.
 */
/*
 * The same failing call is not run twice.
 *
 * Asked to open Gemini's settings, the planner called
 * android.settings.open_app with identical arguments four times — each one
 * failing the same way — then wandered into brightness and auto-rotate and
 * hit the ten-step ceiling with nothing to show. Nothing stopped it: the
 * ledger only looked for successful duplicates, and the loop detector feeds
 * tier escalation rather than termination.
 */
console.log('\nan identical call that already failed is not repeated:');
{
  const ledger = new ToolExecutionLedger();
  const call = {
    id: 'c1',
    toolName: 'android.settings.open_app',
    args: { connectionId: 'android-device', target: 'appDetails', packageName: 'com.x' },
  } as never;

  assert(
    ledger.findRepeatedFailure(call) === undefined,
    'a call that has not been tried is allowed',
  );

  ledger.record(call, {
    status: 'error',
    error: 'The "appDetails" destination is unavailable for com.x.',
    errorCode: 'TOOL_EXECUTION_ERROR',
  });

  const blocked = ledger.findRepeatedFailure(call);
  assert(blocked !== undefined, 'the identical repeat is caught');
  assert(
    blocked?.result?.error?.includes('unavailable') === true,
    'and carries the original reason back, so the model is told why',
  );

  // Different arguments are a different call, and are the recovery the model
  // should be making.
  const other = {
    ...(call as unknown as { id: string; toolName: string; args: Record<string, unknown> }),
    args: { connectionId: 'android-device', target: 'appDetails', packageName: 'com.y' },
  } as never;
  assert(
    ledger.findRepeatedFailure(other) === undefined,
    'a call with different arguments is never blocked',
  );

  // Transient failures describe the world, not the call.
  const flaky = { id: 'c2', toolName: 'google.gmail.list', args: {} } as never;
  for (const errorCode of ['NETWORK_ERROR', 'RATE_LIMITED'] as const) {
    ledger.record(flaky, { status: 'error', error: 'later', errorCode });
    assert(
      ledger.findRepeatedFailure(flaky) === undefined,
      `${errorCode} stays retryable — a second attempt genuinely can succeed`,
    );
  }

  // A success is not a failure, and must still be found by the dedup guard.
  const done = { id: 'c3', toolName: 'calendar.create_event', args: { a: 1 } } as never;
  ledger.record(done, { status: 'success', data: { id: 'e1' } });
  assert(
    ledger.findRepeatedFailure(done) === undefined,
    'a successful call is not mistaken for a failed one',
  );
  assert(
    ledger.findDuplicate(done) !== undefined,
    'and the side-effect dedup guard still sees it',
  );
}

/*
 * And end to end: the second attempt never reaches MCP.
 *
 * The ledger check above proves the rule; this proves the runtime applies it,
 * which is the part that spent a real run's budget.
 */
console.log('\na repeated failing call does not reach the tool twice:');
{
  let executions = 0;
  const failingMcp = {
    listTools: () =>
      Promise.resolve([
        {
          name: 'android.settings.open_app',
          description: 'Open app settings.',
          inputSchema: { properties: {} },
        },
      ]),
    callTool: () => {
      executions += 1;
      const error = new Error(
        'The "appDetails" destination is unavailable for com.x on this device.',
      );
      error.name = 'ToolExecutionError';
      return Promise.reject(error);
    },
  } as never;

  // A planner that never learns: the same call, every step.
  const stubborn: AgentModel = {
    id: 'stubborn',
    capabilities: { textGeneration: true, toolCalling: true, structuredOutput: true },
    run: () =>
      Promise.resolve({
        kind: 'tool_calls',
        toolCalls: [
          {
            id: `call_${executions}`,
            toolName: 'android.settings.open_app',
            args: { connectionId: 'android-device', target: 'appDetails', packageName: 'com.x' },
          },
        ],
      }) as never,
  } as never;

  const runtime = new AgentRuntime({
    model: stubborn,
    mcp: failingMcp,
    connections: [
      { id: 'android-device', provider: 'android', displayName: 'This device', capabilities: [] },
    ],
    approveApproval: () => Promise.resolve(),
    maxSteps: 6,
  });

  await runtime.sendMessage('open the Gemini app settings and turn it off');

  assert(
    executions === 1,
    `the tool is called once however many times the planner asks (called ${executions})`,
  );

  const toolMessages = runtime
    .getMessages()
    .filter((message) => message.role === 'tool');
  assert(
    toolMessages.length > 1,
    'the planner still gets a result for every attempt, so it can change course',
  );
  assert(
    toolMessages
      .slice(1)
      .every((message) =>
        String((message as { result?: { error?: string } }).result?.error ?? '')
          .includes('Repeating it will not help'),
      ),
    'and every repeat is told plainly that repeating will not help',
  );
  assert(
    toolMessages[0]?.result?.error?.includes('unavailable') === true,
    'while the first attempt carries the real reason',
  );
}

console.log('\nthe loop holds while the app is backgrounded:');
{
  function gate() {
    let active = true;
    const waiters: (() => void)[] = [];
    return {
      background: () => {
        active = false;
      },
      foreground: () => {
        active = true;
        for (const resume of waiters.splice(0)) resume();
      },
      waiting: () => waiters.length,
      gate: {
        isActive: () => active,
        waitUntilActive: () =>
          active
            ? Promise.resolve()
            : new Promise<void>((resolve) => waiters.push(resolve)),
      } satisfies ForegroundGate,
    };
  }

  const controller = gate();
  let plannerCalls = 0;
  const calls = () => plannerCalls;

  const model: AgentModel = {
    id: 'counting-planner',
    capabilities: { textGeneration: true, toolCalling: true, structuredOutput: true },
    run: () => {
      plannerCalls += 1;
      // Background the app the way `open_settings` does, on the first step.
      if (plannerCalls === 1) controller.background();
      return Promise.resolve(
        plannerCalls >= 2
          ? { kind: 'final', text: 'done' }
          : { kind: 'final', text: 'first' },
      ) as never;
    },
  } as never;

  const states: string[] = [];
  const runtime = new AgentRuntime({
    model,
    connections: [],
    approveApproval: () => Promise.resolve(),
    foreground: controller.gate,
    onState: (state) => states.push(state.type),
  });

  await runtime.sendMessage('open the assistant settings');
  assert(calls() === 1, 'the first step runs while the app is in front');

  // A second turn, started while backgrounded, must not plan at all.
  const pending = runtime.sendMessage('are we there yet');
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert(
    calls() === 1,
    'no planning happens while the user is on a system screen',
  );
  assert(
    states.includes('paused'),
    'the run reports itself paused rather than leaving "Thinking…" on screen',
  );
  assert(controller.waiting() === 1, 'the run is waiting, not spinning');

  controller.foreground();
  await pending;

  assert(calls() === 2, 'coming back resumes the run');
}

/*
 * Scope failures are permission problems, not stale sessions.
 *
 *   Connection "Xiaomi 2412DPC0AG" is missing required scopes:
 *   android.settings.write.
 *
 * matched the broader `connection "…" is (?!connected)` rule first and was
 * reported as CONNECTION_EXPIRED — "sign in again" for a device permission the
 * user has never granted. Reconnecting fixes nothing.
 */
console.log('\ntool errors are classified by what would actually fix them:');
{
  assert(
    classifyToolError(
      'Connection "Xiaomi 2412DPC0AG" is missing required scopes: android.settings.write.',
    ) === 'PERMISSION_REQUIRED',
    'a missing scope is a permission problem, not an expired connection',
  );
  assert(
    classifyToolError('Connection "Google" is expired.') === 'CONNECTION_EXPIRED',
    'an actually expired connection still classifies as expired',
  );
  assert(
    classifyToolError('Connection "android" was not found.') ===
      'CONNECTION_NOT_FOUND',
    'a missing connection is still not found',
  );
}

/*
 * A permission wall must come with a door.
 *
 * The scope error names `android.settings.write`, a string that appears on no
 * screen the user has ever seen, and the connector did not offer the screen
 * that grants it: `writeSettings` and `overlay` were missing from the open
 * tool's list even though the native navigator resolves both. The user could
 * not find the setting and was never prompted for it.
 */
console.log('\na scope failure tells the model how to fix it:');
{
  const failing = {
    callTool: () => {
      const error = new Error(
        'Connection "Xiaomi 2412DPC0AG" is missing required scopes: ' +
          'android.settings.write.',
      );
      error.name = 'ToolExecutionError';
      return Promise.reject(error);
    },
  } as never;

  const result = await executeToolCall(
    failing,
    {
      id: 'c1',
      toolName: 'android.settings.set_brightness',
      args: { connectionId: 'android-device', level: 0.2 },
    } as never,
  );

  assert(
    result.status === 'error' && result.errorCode === 'PERMISSION_REQUIRED',
    'the failure is a permission problem',
  );
  assert(
    result.error?.includes('android.settings.open') === true &&
      result.error.includes('writeSettings'),
    'and the error names the tool and screen that put the switch in front of the user',
  );
  assert(
    result.error?.includes('Allow modifying system settings') === true,
    'in the words Android itself uses on that screen',
  );
  assert(
    (result.error?.length ?? 0) <= 600,
    'and still fits the budget the model is given for an error',
  );

  /*
   * A long validation error keeps both ends. The fix lives at the tail —
   * "expected one of …" — and cutting it left the model told it was wrong and
   * not what would be right.
   */
  {
    const options = Array.from(
      { length: 60 },
      (_unused, index) => `"appTarget${index}"`,
    ).join('|');
    const long = {
      callTool: () => {
        const error = new Error(
          'Input validation error: Invalid arguments for tool ' +
            `android.settings.open_app: target: Invalid option: expected one of ${options}`,
        );
        error.name = 'ToolExecutionError';
        return Promise.reject(error);
      },
    } as never;

    const trimmed = await executeToolCall(
      long,
      { id: 'c2', toolName: 'android.settings.open_app', args: {} } as never,
    );
    const text = trimmed.error ?? '';

    assert(text.length <= 600, 'the message still fits the budget');
    assert(
      text.includes('android.settings.open_app: target'),
      'the head says which argument was wrong',
    );
    assert(
      text.includes('"appTarget59"'),
      'and the tail still carries the valid options, which is the fix',
    );
  }

  /*
   * The invariant that actually broke. The remedy named `writeSettings`; the
   * open tool's enum did not contain it, so a model that followed the advice
   * exactly would have been rejected by the schema. Advice pointing at a door
   * that is not there is worse than no advice.
   */
  const offered = new Set<string>(OPEN_SCREENS);
  for (const [scope, remedy] of SCOPE_REMEDIES) {
    assert(
      offered.has(remedy.screen),
      `the screen the ${scope} remedy names ("${remedy.screen}") is one android.settings.open will accept`,
    );
    assert(
      remedy.advice.includes(remedy.screen),
      `and the ${scope} advice actually names it`,
    );
  }
}

console.log('verify:agent — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
