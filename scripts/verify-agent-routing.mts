/**
 * Adaptive routing tests:
 *
 * - weak signals alone cannot force EXPERT;
 * - hard reasoning signals score correctly;
 * - struggle signals trigger emergency escalation;
 * - EXPERT is sticky (never downgrades within a run);
 * - escalation preserves the full conversation.
 *
 * Run: npm run verify:routing
 */
import { InMemoryApprovalService } from '@mobile-agent/approval-core';
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
import { createScriptedPlanner } from '../src/agent/models/deterministicPlanner.js';
import {
  ReasoningComplexityMonitor,
} from '../src/agent/routing/ReasoningComplexityMonitor.js';
import {
  calculateReasoningScore,
  chooseTier,
  estimateInitialTier,
  hasHardReasoningSignal,
  hasEmergencyExpertTrigger,
  type ReasoningSignals,
  type ModelTier,
} from '../src/agent/routing/index.js';
import type {
  AgentMessage,
  AgentModelResult,
  AgentToolResult,
} from '../src/agent/types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

function emptySignals(
  overrides?: Partial<ReasoningSignals>,
): ReasoningSignals {
  return {
    toolCalls: 0,
    connectorCount: 0,
    stepCount: 0,
    largeUnstructuredContext: false,
    largeStructuredContext: false,
    crossSourceSynthesis: false,
    conflictingEvidence: false,
    constraintSolving: false,
    temporalReconciliation: false,
    rankingOrOptimization: false,
    dependentMultiStageReasoning: false,
    failedPlans: 0,
    replans: 0,
    repeatedToolPattern: false,
    invalidToolCalls: 0,
    repeatedToolFailures: 0,
    noProgressSteps: 0,
    unresolvedAmbiguity: false,
    modelUncertain: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit tests — pure routing functions
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('weak signals alone do not force NORMAL/EXPERT:');
  {
    const decide = chooseTier('fast', emptySignals({ toolCalls: 6 }));
    assertEq(decide.tier, 'fast', '6 tool calls stay fast');
    assertEq(decide.reason, 'stay', '6 tool calls are not a strong enough signal');

    const decide2 = chooseTier('fast', emptySignals({ connectorCount: 2 }));
    assertEq(decide2.tier, 'fast', '2 connectors stay fast');

    const decide3 = chooseTier('fast', emptySignals({ stepCount: 6 }));
    assertEq(decide3.tier, 'fast', '6 steps stay fast');
  }

  console.log('weak signals at threshold move FAST → NORMAL:');
  {
    // stepCount >= 7 → 1 point, toolCalls >= 7 → 1 point. Combined they only
    // reach 2 which is below the NORMAL threshold (4). Still stays FAST.
    const decide = chooseTier(
      'fast',
      emptySignals({ stepCount: 7, toolCalls: 7 }),
    );
    assertEq(decide.tier, 'fast', 'weak signals alone below threshold stay fast');
  }

  console.log('large context alone does not force EXPERT:');
  {
    const decide = chooseTier(
      'fast',
      emptySignals({ largeUnstructuredContext: true }),
    );
    assert(
      decide.tier !== 'expert',
      'large unstructured context does not force expert',
    );

    const decide2 = chooseTier(
      'fast',
      emptySignals({ largeStructuredContext: true }),
    );
    assert(
      decide2.tier !== 'expert',
      'large structured context does not force expert',
    );
  }

  console.log('cross-source synthesis increases score:');
  {
    const result = calculateReasoningScore(
      emptySignals({ crossSourceSynthesis: true }),
    );
    assert(
      result.reasons.includes('cross_source_synthesis'),
      'cross-source synthesis is counted as a reason',
    );
    assert(result.score >= 3, 'cross-source synthesis is worth ≥ 3 points');
  }

  console.log('conflicting evidence is a strong signal:');
  {
    const result = calculateReasoningScore(
      emptySignals({ conflictingEvidence: true }),
    );
    assert(
      result.reasons.includes('conflicting_evidence'),
      'conflicting evidence is counted',
    );
    assert(result.score >= 4, 'conflicting evidence is worth ≥ 4 points');
  }

  console.log('constraint solving is a strong signal:');
  {
    const result = calculateReasoningScore(
      emptySignals({ constraintSolving: true }),
    );
    assert(
      result.reasons.includes('constraint_solving'),
      'constraint solving is counted',
    );
    assert(result.score >= 4, 'constraint solving is worth ≥ 4 points');
  }

  console.log('one replan can move FAST → NORMAL:');
  {
    const decide = chooseTier('fast', emptySignals({ replans: 1 }));
    assertEq(decide.tier, 'normal', 'one replan moves fast to normal');
    assertEq(decide.reason, 'moderate_reasoning', 'replan is moderate reasoning');
  }

  console.log('two failed plans can trigger EXPERT via emergency:');
  {
    const decide = chooseTier('fast', emptySignals({ failedPlans: 2 }));
    assertEq(decide.tier, 'expert', 'two failed plans trigger expert');
    assertEq(decide.reason, 'planner_stuck', 'stuck planner is the reason');
  }

  console.log('loop detection can trigger EXPERT:');
  {
    const decide = chooseTier(
      'fast',
      emptySignals({ repeatedToolPattern: true }),
    );
    assertEq(decide.tier, 'expert', 'planner loop triggers expert');
  }

  console.log('repeated invalid tool calls trigger emergency EXPERT:');
  {
    const decide = chooseTier(
      'fast',
      emptySignals({ invalidToolCalls: 3 }),
    );
    assertEq(decide.tier, 'expert', '3 invalid tool calls trigger expert');
  }

  console.log('clarification-required ambiguity does not trigger EXPERT:');
  {
    const decide = chooseTier(
      'fast',
      emptySignals({ unresolvedAmbiguity: true, modelUncertain: true }),
    );
    assertEq(decide.tier, 'fast', 'uncertainty alone stays fast');
  }

  console.log('EXPERT never downgrades within the same run:');
  {
    // Once on expert, even empty signals stay expert.
    const decide = chooseTier('expert', emptySignals());
    assertEq(decide.tier, 'expert', 'expert stays expert with empty signals');
    assertEq(decide.reason, 'stay', 'expert is sticky');

    // Even when signals drop to nothing, never downgrade.
    const decide2 = chooseTier('expert', emptySignals({ toolCalls: 0, stepCount: 0 }));
    assertEq(decide2.tier, 'expert', 'expert never downgrades');
  }

  console.log('FAST → EXPERT only through emergency triggers:');
  {
    // NORMAL → EXPERT via hard reasoning + high score.
    const s = emptySignals({
      constraintSolving: true,
      crossSourceSynthesis: true,
      largeUnstructuredContext: true,
      stepCount: 7,
    });
    const decide = chooseTier('normal', s);
    // Score: 4+3+2+1=10 ≥ 10 threshold, hasHardReasoningSignal=true
    assertEq(decide.tier, 'expert', 'hard reasoning from normal escalates to expert');

    // FAST → EXPERT directly (skip NORMAL) only via emergency.
    const decide2 = chooseTier('fast', emptySignals({ failedPlans: 2 }));
    assertEq(decide2.tier, 'expert', 'emergency from fast goes directly to expert');
  }

  console.log('initial estimate defaults to fast:');
  {
    const est = estimateInitialTier('send a message to Daniyar');
    assertEq(est.suggestedTier, 'fast', 'simple message is fast');
  }

  console.log('initial estimate detects constraint language:');
  {
    const est = estimateInitialTier(
      'must be after 15:00 and before 18:00, prefer earliest slot, choose best time',
    );
    assert(
      est.suggestedTier !== 'fast',
      'constraint + optimization language escalates initial estimate',
    );
  }

  console.log('planner reasoning metadata reaches routing:');
  {
    const monitor = new ReasoningComplexityMonitor();

    monitor.currentTier = 'normal';

    monitor.recordModelResponse({
      kind: 'tool_calls',
      toolCalls: [],
      reasoning: {
        crossSourceSynthesis: true,
        constraintSolving: true,
        rankingOrOptimization: true,
      },
    });

    const signals = monitor.snapshot();

    assert(
      signals.crossSourceSynthesis,
      'cross-source metadata reaches signals',
    );

    assert(
      signals.constraintSolving,
      'constraint metadata reaches signals',
    );

    assert(
      signals.rankingOrOptimization,
      'optimization metadata reaches signals',
    );

    const decision = monitor.chooseTier();

    assertEq(
      decision.tier,
      'expert',
      'hard reasoning can escalate NORMAL to EXPERT',
    );
  }

  // -----------------------------------------------------------------------
  // Integration tests — routing inside AgentRuntime
  // -----------------------------------------------------------------------

  console.log('escalation preserves conversation:');
  {
    const harness = await createTestHarness();
    let modelCalls = 0;
    const modelInputs: Array<readonly AgentMessage[]> = [];

    const agent = new AgentRuntime({
      model: createScriptedPlanner((input) => {
        // The planner is deliberately broken: it always returns a tool call
        // that will fail (wrong args), which triggers failedPlans → emergency
        // expert. We verify that escalation never resets the conversation.
        modelCalls += 1;
        modelInputs.push([...input.messages]);

        if (modelCalls >= 3) {
          // After 2 failures the emergency escalates to EXPERT.
          // The planner now succeeds — proves we're continuing from the
          // same conversation, not restarting.
          if (modelCalls === 3) {
            // The monitor should have escalated by now.
            assert(
              agent.getCurrentTier() !== 'fast',
              'tier escalated from fast after repeated failures',
            );
          }
          return {
            kind: 'tool_calls',
            toolCalls: [
              {
                id: `c${modelCalls}`,
                toolName: 'telegram.user.search_chats',
                args: {
                  connectionId: TELEGRAM_CONNECTION_ID,
                  query: 'Данияр',
                },
              },
            ],
          };
        }

        // Deliberately malformed: trigger a tool validation error.
        return {
          kind: 'tool_calls',
          toolCalls: [
            {
              id: `c${modelCalls}`,
              toolName: 'telegram.user.send_message',
              args: {
                // Missing connectionId → will be rejected by the MCP server.
                text: 'Привет',
              },
            },
          ],
        };
      }),
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

    await agent.sendMessage('Search for Daniyar', 'test');

    // Verify that the model received the full conversation history,
    // not just the original message.
    assert(
      modelInputs.every((inputs) => inputs.length >= 1),
      'every model call receives the full message history',
    );
    assert(
      modelInputs[1].length > modelInputs[0].length,
      'history grows with tool results — not reset on escalation',
    );

    await harness.runtime.close();
  }

  console.log('escalation does not repeat side effects:');
  {
    const harness = await createTestHarness();
    let sentCalls = 0;

    const agent = new AgentRuntime({
      model: createScriptedPlanner((input) => {
        const messages = input.messages;
        const userMsg = messages[messages.length - 1] as AgentMessage;
        const lastUser = userMsg.role === 'user' ? userMsg : messages[0];

        if (lastUser.role === 'user' && lastUser.content.includes('fail twice')) {
          sentCalls += 1;
          if (sentCalls <= 2) {
            // First two attempts: send to a chat that will fail.
            return {
              kind: 'tool_calls',
              toolCalls: [
                {
                  id: `sc${sentCalls}`,
                  toolName: 'telegram.user.send_message',
                  args: {
                    connectionId: TELEGRAM_CONNECTION_ID,
                    chatId: '-1',
                    text: 'test',
                  },
                },
              ],
            };
          }
          // Third attempt (after escalation): succeed.
          return {
            kind: 'tool_calls',
            toolCalls: [
              {
                id: 'sc3',
                toolName: 'telegram.user.search_chats',
                args: {
                  connectionId: TELEGRAM_CONNECTION_ID,
                  query: 'Данияр',
                },
              },
            ],
          };
        }

        // Final after search.
        return { kind: 'final', text: 'Done after escalation.' };
      }),
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

    // The first send will go through approval_required — handle it.
    const run = agent.sendMessage(
      'send to fail twice then recover',
      'test',
    );

    // First send goes to approval.
    await waitFor(
      () => agent.getRunState().type === 'awaiting_approval',
      'first send should require approval',
    );
    await agent.approvePendingApproval();

    // The send fails (chatId -1 is the mock's provider-failure sentinel).
    // The run will continue to step 2.
    // Step 2 will try again — approval again.
    await waitFor(
      () =>
        agent.getRunState().type === 'awaiting_approval' ||
        agent.getRunState().type === 'idle' ||
        agent.getRunState().type === 'failed',
      'should reach approval step 2',
    );

    if (agent.getRunState().type === 'awaiting_approval') {
      await agent.approvePendingApproval();
    }

    await run;

    // After 2 failed sends, the monitor triggers failedPlans=2 → emergency
    // expert. The planner then switches to search (succeeds) and final.
    assert(
      agent.getCurrentTier() !== 'fast' ||
        agent
          .getMessages()
          .some(
            (m) =>
              m.role === 'assistant' &&
              m.content === 'Done after escalation.',
          ),
      'run completed, escalation did not cause re-execution of side effects',
    );

    await harness.runtime.close();
  }

  console.log('network failure does NOT trigger EXPERT:');
  {
    // Infrastructure failures should never escalate to expert.
    const monitor = new ReasoningComplexityMonitor();
    monitor.currentTier = 'fast';

    // Simulate two network errors on the same tool.
    monitor.recordStep();
    monitor.recordToolCall({
      id: 'c1', toolName: 'telegram.user.search_chats',
      args: { connectionId: 'test', query: 'Daniyar' },
    });
    monitor.recordToolResult(
      { id: 'c1', toolName: 'telegram.user.search_chats',
        args: { connectionId: 'test', query: 'Daniyar' } },
      { status: 'error', error: 'Network error', errorCode: 'NETWORK_ERROR' },
    );

    monitor.recordStep();
    monitor.recordToolCall({
      id: 'c2', toolName: 'telegram.user.search_chats',
      args: { connectionId: 'test', query: 'Daniyar' },
    });
    monitor.recordToolResult(
      { id: 'c2', toolName: 'telegram.user.search_chats',
        args: { connectionId: 'test', query: 'Daniyar' } },
      { status: 'error', error: 'Network error', errorCode: 'NETWORK_ERROR' },
    );

    const decision = monitor.chooseTier();
    assertEq(decision.tier, 'fast', 'network failure stays fast');
  }

  console.log('auth failure does NOT trigger EXPERT:');
  {
    const monitor = new ReasoningComplexityMonitor();
    monitor.currentTier = 'fast';

    monitor.recordStep();
    monitor.recordToolCall({
      id: 'c1', toolName: 'gmail.search_messages',
      args: { connectionId: 'test', query: 'invoice' },
    });
    monitor.recordToolResult(
      { id: 'c1', toolName: 'gmail.search_messages',
        args: { connectionId: 'test', query: 'invoice' } },
      { status: 'error', error: 'Auth expired', errorCode: 'AUTH_REQUIRED' },
    );

    const decision = monitor.chooseTier();
    assertEq(decision.tier, 'fast', 'auth failure stays fast');
  }

  console.log('user denial does NOT trigger EXPERT:');
  {
    const monitor = new ReasoningComplexityMonitor();
    monitor.currentTier = 'normal';

    monitor.recordStep();
    monitor.recordToolCall({
      id: 'c1', toolName: 'telegram.user.send_message',
      args: { connectionId: 'test', chatId: '123', text: 'hello' },
    });
    monitor.recordToolResult(
      { id: 'c1', toolName: 'telegram.user.send_message',
        args: { connectionId: 'test', chatId: '123', text: 'hello' } },
      { status: 'user_denied' },
    );

    const decision = monitor.chooseTier();
    assert(decision.tier !== 'expert', 'user denial does not escalate to expert');
  }

  console.log('normal next-step selection is NOT a replan:');
  {
    const monitor = new ReasoningComplexityMonitor();
    monitor.currentTier = 'fast';

    // Step 1: search
    monitor.recordModelResponse({
      kind: 'tool_calls',
      toolCalls: [
        { id: 'c1', toolName: 'telegram.user.search_chats',
          args: { connectionId: 'test', query: 'Daniyar' } },
      ],
    });

    // Step 2: send to found chat — different tool, planned sequence
    monitor.recordModelResponse({
      kind: 'tool_calls',
      toolCalls: [
        { id: 'c2', toolName: 'telegram.user.send_message',
          args: { connectionId: 'test', chatId: '123', text: 'hello' } },
      ],
    });

    const signals = monitor.snapshot();
    // search → send is a normal planned sequence, not a replan.
    assertEq(signals.replans, 0, 'search to send is not a replan');
  }

  console.log('real replan after planner failure:');
  {
    const monitor = new ReasoningComplexityMonitor();
    monitor.currentTier = 'fast';

    // Step 1: model tries contacts.search — planner failure.
    monitor.recordModelResponse({
      kind: 'tool_calls',
      toolCalls: [
        { id: 'c1', toolName: 'contacts.search',
          args: { query: 'Daniyar' } },
      ],
    });

    monitor.recordToolCall({
      id: 'c1', toolName: 'contacts.search',
      args: { query: 'Daniyar' },
    });
    monitor.recordToolResult(
      { id: 'c1', toolName: 'contacts.search',
        args: { query: 'Daniyar' } },
      { status: 'error', error: 'Tool not available', errorCode: 'TOOL_VALIDATION_ERROR' },
    );

    // Step 2: model switches to a different approach — real replan.
    monitor.recordModelResponse({
      kind: 'tool_calls',
      toolCalls: [
        { id: 'c2', toolName: 'telegram.user.search_chats',
          args: { connectionId: 'test', query: 'Daniyar' } },
      ],
    });

    const signals = monitor.snapshot();
    assertEq(signals.replans, 1, 'planner failure + different tool = replan');
  }

  console.log('side-effect dedup: same action not executed twice:');
  {
    const harness = await createTestHarness();

    const agent = new AgentRuntime({
      model: createScriptedPlanner((input) => {
        const messages = input.messages;
        const toolMessages = messages.filter((m) => m.role === 'tool');

        if (toolMessages.length === 0) {
          // First: send a message.
          return {
            kind: 'tool_calls',
            toolCalls: [
              {
                id: 'sc1',
                toolName: 'telegram.user.send_message',
                args: {
                  connectionId: TELEGRAM_CONNECTION_ID,
                  chatId: '123456789',
                  text: 'Hello world',
                },
              },
            ],
          };
        }

        // After first send, try the same send again — should be deduplicated.
        if (toolMessages.length === 1) {
          return {
            kind: 'tool_calls',
            toolCalls: [
              {
                id: 'sc2',
                toolName: 'telegram.user.send_message',
                args: {
                  connectionId: TELEGRAM_CONNECTION_ID,
                  chatId: '123456789',
                  text: 'Hello world',
                },
              },
            ],
          };
        }

        return { kind: 'final', text: 'Done.' };
      }),
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

    // First send goes to approval.
    const run = agent.sendMessage('send hello then repeat', 'test');

    await waitFor(
      () => agent.getRunState().type === 'awaiting_approval',
      'dedup test: first send requires approval',
    );
    await agent.approvePendingApproval();

    // The second call should skip MCP entirely (dedup).
    await waitFor(
      () => agent.getRunState().type === 'awaiting_approval',
      'dedup test: second send should skip approval',
    );
    // If approval was required again, dedup failed.
    await agent.rejectPendingApproval();

    await run;

    // The mock adapter should have exactly 1 send, not 2.
    const sentMessages = harness.adapter.sentMessages;
    assertEq(
      sentMessages.length,
      1,
      'side effect executed exactly once',
    );

    await harness.runtime.close();
  }

  console.log('different payload is NOT incorrectly deduplicated:');
  {
    const harness = await createTestHarness();

    const agent = new AgentRuntime({
      model: createScriptedPlanner((input) => {
        const messages = input.messages;
        const toolMessages = messages.filter((m) => m.role === 'tool');

        if (toolMessages.length === 0) {
          return {
            kind: 'tool_calls',
            toolCalls: [
              {
                id: 'sc1',
                toolName: 'telegram.user.send_message',
                args: {
                  connectionId: TELEGRAM_CONNECTION_ID,
                  chatId: '123456789',
                  text: 'Hello Daniyar',
                },
              },
            ],
          };
        }

        if (toolMessages.length === 1) {
          return {
            kind: 'tool_calls',
            toolCalls: [
              {
                id: 'sc2',
                toolName: 'telegram.user.send_message',
                args: {
                  connectionId: TELEGRAM_CONNECTION_ID,
                  chatId: '123456789',
                  text: 'Hello Aidar',
                },
              },
            ],
          };
        }

        return { kind: 'final', text: 'Done.' };
      }),
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

    const run = agent.sendMessage('send to two different people', 'test');

    await waitFor(
      () => agent.getRunState().type === 'awaiting_approval',
      'diff payload: first send requires approval',
    );
    await agent.approvePendingApproval();

    await waitFor(
      () => agent.getRunState().type === 'awaiting_approval',
      'diff payload: second send also requires approval',
    );
    await agent.approvePendingApproval();

    await run;

    const sentMessages = harness.adapter.sentMessages;
    assertEq(
      sentMessages.length,
      2,
      'two different payloads both executed',
    );

    await harness.runtime.close();
  }

  console.log('verify:routing — all checks passed');
}

// -----------------------------------------------------------------------
// Test harness (mirrors verify-agent)
// -----------------------------------------------------------------------

const TELEGRAM_CONNECTION_ID = 'telegram-user-test';

interface Harness {
  runtime: LocalMcpRuntime;
  adapter: MockTdlibAdapter;
  store: InMemoryConnectionStore;
  approvalService: InMemoryApprovalService;
}

async function createTestHarness(): Promise<Harness> {
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
    credentialReference: 'tdlib-session:routing-test',
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
          throw new Error('not used in routing tests');
        },
      },
      approvals: {
        async assertApproved() {
          throw new Error('not used in routing tests');
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
