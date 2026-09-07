/**
 * Remote agent wire-contract tests.
 *
 * Verifies the request shape, response parsing, error handling, Zod
 * validation and execution metadata of the POST /agent/step adapter.
 *
 * Run: npm run verify:remote-agent
 */
import { createRemoteAgentModel } from '../src/agent/models/remoteAgentModel.js';
import { AgentError } from '../src/agent/types.js';
import { AgentRuntime } from '../src/agent/AgentRuntime.js';
import { resolveEngine } from '../src/ai/index.js';
import type {
  AgentModel,
  AgentModelInput,
  AgentModelResult,
} from '../src/agent/types.js';
import type { AgentMcpClient } from '@mobile-agent/mcp-client';
import type { LlmRoutingContext } from '../src/agent/routing/types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

function baseInput(overrides?: Partial<AgentModelInput>): AgentModelInput {
  return {
    runId: 'run-test-1',
    messages: [
      { id: 'msg_1', role: 'user' as const, content: 'Find Daniyar in Telegram' },
    ],
    tools: [
      {
        name: 'telegram.user.search_chats',
        description: 'Search chats',
        inputSchema: {
          properties: {
            connectionId: { type: 'string' },
            query: { type: 'string' },
          },
        },
      },
    ],
    connections: [
      {
        id: 'telegram-user-test',
        provider: 'telegram-user',
        displayName: 'Test User',
        capabilities: ['telegram.user.search_chats'],
      },
    ],
    routing: {
      requestedTier: 'normal',
      reasoningScore: 5,
      hardReasoningSignals: [],
      weakSignals: { stepCount: 1, toolCalls: 0, connectorCount: 1 },
      struggle: {
        failedPlans: 0,
        replans: 0,
        repeatedToolPattern: false,
        invalidToolCalls: 0,
        repeatedToolFailures: 0,
      },
      context: {
        largeStructuredContext: false,
        largeUnstructuredContext: false,
      },
      escalationCount: 0,
    } satisfies LlmRoutingContext,
    ...overrides,
  };
}

function successBody(
  result: unknown,
  overrides?: {
    requestedModelTier?: string;
    effectiveModelTier?: string;
    routingReason?: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  },
): string {
  return JSON.stringify({
    requestedModelTier: overrides?.requestedModelTier ?? 'normal',
    effectiveModelTier: overrides?.effectiveModelTier ?? 'normal',
    routingReason: overrides?.routingReason ?? 'requested',
    usage: overrides?.usage === undefined ? null : overrides.usage,
    result,
  });
}

type FetchMock = (
  url: string | URL,
  init?: RequestInit,
) => Promise<Response>;

function withFetch<T>(mock: FetchMock, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = mock;
  return fn().finally(() => {
    (globalThis as Record<string, unknown>).fetch = original;
  });
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------
  // A. Request shape — runId, routing, connections
  // -------------------------------------------------------------------
  console.log('request body contains runId, routing and connections:');
  {
    const fetches: Array<{ body: unknown }> = [];

    const mockFetch: FetchMock = async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      fetches.push({ body });
      return new Response(
        successBody({ kind: 'final', text: 'ok' }),
        { status: 200 },
      );
    };

    const model = createRemoteAgentModel({
      baseUrl: 'http://test',
      getAccessToken: () => Promise.resolve(null),
    });

    await withFetch(mockFetch, () => model.run(baseInput()));

    const body = fetches[0].body as Record<string, unknown>;
    assertEq(body.runId, 'run-test-1', 'runId is sent');
    assert(body.requestId !== undefined, 'requestId is present');

    const routing = body.routing as Record<string, unknown>;
    assertEq(routing.requestedTier, 'normal', 'routing context is sent');

    const connections = body.connections as Array<unknown>;
    assertEq(connections.length, 1, 'connections are sent');

    assert(body.tools !== undefined, 'tools are sent');
    assert(body.messages !== undefined, 'messages are sent');
  }

  // -------------------------------------------------------------------
  // B. Final response
  // -------------------------------------------------------------------
  console.log('final response:');
  {
    const mockFetch: FetchMock = async () => {
      return new Response(
        successBody({ kind: 'final', text: 'Done' }),
        { status: 200 },
      );
    };

    const model = createRemoteAgentModel({
      baseUrl: 'http://test',
    });

    const result = await withFetch(mockFetch, () => model.run(baseInput()));

    assert(result.kind === 'final', 'kind is final');
    assert(result.kind === 'final' && result.text === 'Done', 'text matches');
  }

  // -------------------------------------------------------------------
  // C. Tool call with text: null
  // -------------------------------------------------------------------
  console.log('tool call with text: null:');
  {
    const mockFetch: FetchMock = async () => {
      return new Response(
        successBody({
          kind: 'tool_calls',
          text: null,
          toolCalls: [
            {
              id: 'call_1',
              toolName: 'telegram.user.search_chats',
              args: { connectionId: 'telegram-user-test', query: 'Daniyar' },
            },
          ],
        }),
        { status: 200 },
      );
    };

    const model = createRemoteAgentModel({
      baseUrl: 'http://test',
    });

    const result = await withFetch(mockFetch, () => model.run(baseInput()));

    assert(result.kind === 'tool_calls', 'kind is tool_calls');
    assert(
      result.kind === 'tool_calls' && result.text === undefined,
      'text: null is normalized to undefined',
    );
    assert(
      result.kind === 'tool_calls' && result.toolCalls.length === 1,
      'toolCalls present',
    );
    assert(
      result.kind === 'tool_calls' &&
        result.toolCalls[0].toolName === 'telegram.user.search_chats',
      'tool name preserved',
    );
  }

  // -------------------------------------------------------------------
  // D. Execution metadata
  // -------------------------------------------------------------------
  console.log('execution metadata:');
  {
    const mockFetch: FetchMock = async () => {
      return new Response(
        successBody(
          { kind: 'final', text: 'Done' },
          {
            requestedModelTier: 'expert',
            effectiveModelTier: 'normal',
            routingReason: 'expert_budget_unavailable',
            usage: {
              promptTokens: 100,
              completionTokens: 30,
              totalTokens: 130,
            },
          },
        ),
        { status: 200 },
      );
    };

    const model = createRemoteAgentModel({
      baseUrl: 'http://test',
    });

    const result = (await withFetch(mockFetch, () =>
      model.run(baseInput()),
    )) as AgentModelResult;

    assert(
      result.execution?.requestedTier === 'expert',
      'requested tier is expert',
    );
    assert(
      result.execution?.effectiveTier === 'normal',
      'effective tier is normal',
    );
    assert(
      result.execution?.routingReason === 'expert_budget_unavailable',
      'routing reason is preserved',
    );
    assert(
      result.execution?.usage?.totalTokens === 130,
      'token usage is preserved',
    );
  }

  // -------------------------------------------------------------------
  // E. Error responses
  // -------------------------------------------------------------------
  console.log('error responses:');

  async function assertErrorCode(
    status: number,
    body: unknown,
    expectedCode: string,
    label: string,
  ): Promise<void> {
    const mockFetch: FetchMock = async () => {
      return new Response(
        typeof body === 'string' ? body : JSON.stringify(body),
        { status },
      );
    };

    const model = createRemoteAgentModel({
      baseUrl: 'http://test',
    });

    try {
      await withFetch(mockFetch, () => model.run(baseInput()));
      throw new Error(`FAIL: expected error for ${label}`);
    } catch (error) {
      assert(error instanceof AgentError, `${label} throws AgentError`);
      if (error instanceof AgentError) {
        assertEq(error.code, expectedCode, `${label} code is ${expectedCode}`);
      }
    }
  }

  await assertErrorCode(401, { message: 'Unauthorized' }, 'AUTH_REQUIRED', '401');
  await assertErrorCode(429, { message: 'Too many requests' }, 'RATE_LIMITED', '429');
  await assertErrorCode(422, { message: 'Bad request' }, 'MODEL_ERROR', '422');
  await assertErrorCode(502, { message: 'Bad gateway' }, 'NETWORK_ERROR', '502');

  // -------------------------------------------------------------------
  // E2. Invalid JSON / schema — MODEL_ERROR
  // -------------------------------------------------------------------
  console.log('invalid server response:');
  {
    const mockFetch: FetchMock = async () => {
      return new Response(
        JSON.stringify({ result: { kind: 'invalid', text: 123 } }),
        { status: 200 },
      );
    };

    const model = createRemoteAgentModel({
      baseUrl: 'http://test',
    });

    try {
      await withFetch(mockFetch, () => model.run(baseInput()));
      throw new Error('FAIL: expected error for invalid schema');
    } catch (error) {
      assert(error instanceof AgentError, 'invalid schema throws AgentError');
      if (error instanceof AgentError) {
        assertEq(error.code, 'MODEL_ERROR', 'invalid schema code is MODEL_ERROR');
      }
    }
  }

  // -------------------------------------------------------------------
  // E3. Malformed JSON — MODEL_ERROR
  // -------------------------------------------------------------------
  console.log('malformed JSON response:');
  {
    const mockFetch: FetchMock = async () => {
      return new Response(
        '{not valid json',
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      );
    };

    const model = createRemoteAgentModel({
      baseUrl: 'http://test',
    });

    try {
      await withFetch(mockFetch, () => model.run(baseInput()));
      throw new Error('FAIL: expected error for malformed JSON');
    } catch (error) {
      assert(error instanceof AgentError, 'malformed JSON throws AgentError');
      if (error instanceof AgentError) {
        assertEq(error.code, 'MODEL_ERROR', 'malformed JSON code is MODEL_ERROR');
      }
    }
  }

  // -------------------------------------------------------------------
  // A. Engine origin selection — remote is gated on EXPO_PUBLIC_API_URL,
  //    NOT on the legacy TanStack stream URL.
  // -------------------------------------------------------------------
  console.log('engine origin selection:');
  {
    const cloudSelection = {
      memoryProfile: 'cloud' as const,
      assessment: null,
    };

    const remoteByCloud = resolveEngine(cloudSelection, {
      backendApiUrl: 'http://test-backend:8000',
    });
    assert(
      remoteByCloud.origin === 'remote',
      'cloud profile + backend URL → origin remote (no TanStack URL needed)',
    );

    const remoteForced = resolveEngine(cloudSelection, {
      backendApiUrl: 'http://test-backend:8000',
      forcedEngine: 'remote',
    });
    assert(
      remoteForced.origin === 'remote',
      'forced remote + backend URL → origin remote',
    );

    const noBackend = resolveEngine(cloudSelection, { backendApiUrl: '' });
    assert(
      noBackend.origin === 'stub',
      'cloud profile without backend URL → stub (degraded)',
    );
    assert(
      noBackend.degradedReason != null,
      'missing backend URL surfaces a degraded reason',
    );

    assertEq(
      createRemoteAgentModel({ baseUrl: 'http://test' }).id,
      'remote-agent',
      'remote model id is remote-agent',
    );
  }

  // -------------------------------------------------------------------
  // C/D. URL and Authorization header on the wire
  // -------------------------------------------------------------------
  console.log('request URL and Authorization header:');
  {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    const mockFetch: FetchMock = async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(
        successBody({ kind: 'final', text: 'ok' }),
        { status: 200 },
      );
    };

    const model = createRemoteAgentModel({
      baseUrl: 'http://test-backend:8000',
      getAccessToken: () => Promise.resolve('token-123'),
    });

    await withFetch(mockFetch, () => model.run(baseInput()));

    assertEq(
      capturedUrl,
      'http://test-backend:8000/agent/step',
      'POST target is {baseUrl}/agent/step',
    );
    assertEq(
      capturedHeaders['Authorization'],
      'Bearer token-123',
      'Authorization Bearer header is sent',
    );
    assertEq(
      capturedHeaders['Content-Type'],
      'application/json',
      'Content-Type is application/json',
    );
  }

  // -------------------------------------------------------------------
  // F/G. Local MCP unavailable must not block plain remote chat.
  // -------------------------------------------------------------------
  console.log('remote chat degrades when local MCP is unavailable:');
  {
    let capturedTools: unknown = 'unset';
    let reachedFinal = false;

    const recordingModel: AgentModel = {
      id: 'recording-model',
      capabilities: {
        textGeneration: true,
        toolCalling: true,
        structuredOutput: true,
      },
      async run(input: AgentModelInput): Promise<AgentModelResult> {
        capturedTools = input.tools;
        return { kind: 'final', text: 'ok' };
      },
    };

    const failingMcp = {
      async listTools() {
        throw new Error('MCP unavailable');
      },
    } as unknown as AgentMcpClient;

    const runtime = new AgentRuntime({
      model: recordingModel,
      mcp: failingMcp,
      connections: [],
      approveApproval: async () => {},
      maxSteps: 2,
      onState: (state) => {
        if (state.type === 'responding') reachedFinal = true;
      },
    });

    await runtime.sendMessage('hello', 't-mcp-down');

    assert(
      Array.isArray(capturedTools) && capturedTools.length === 0,
      'MCP listTools failure degrades to tools: []',
    );
    assert(reachedFinal, 'plain remote chat still completes without MCP');
  }

  {
    let reachedFinal = false;

    const recordingModel: AgentModel = {
      id: 'recording-model-2',
      capabilities: {
        textGeneration: true,
        toolCalling: true,
        structuredOutput: true,
      },
      async run(): Promise<AgentModelResult> {
        return { kind: 'final', text: 'ok' };
      },
    };

    // No MCP client at all (still initializing / failed to bootstrap).
    const runtime = new AgentRuntime({
      model: recordingModel,
      connections: [],
      approveApproval: async () => {},
      maxSteps: 2,
      onState: (state) => {
        if (state.type === 'responding') reachedFinal = true;
      },
    });

    await runtime.sendMessage('hello', 't-no-mcp');

    assert(
      reachedFinal,
      'sendMessage is not a silent no-op when MCP is absent',
    );
  }

  // -------------------------------------------------------------------
  // Z. Expiry — a 401 is retried once with a refreshed token
  // -------------------------------------------------------------------
  console.log('\nexpired access token:');
  {
    const bearers: (string | null)[] = [];
    let refreshes = 0;

    const mockFetch: FetchMock = async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const auth = headers['Authorization'] ?? null;
      bearers.push(auth);
      // The first token is stale; the refreshed one is accepted.
      if (auth === 'Bearer stale') {
        return new Response(
          JSON.stringify({ message: 'Token is invalid or expired' }),
          { status: 401 },
        );
      }
      return new Response(successBody({ kind: 'final', text: 'ok' }), { status: 200 });
    };

    const model = createRemoteAgentModel({
      baseUrl: 'http://test',
      getAccessToken: () => Promise.resolve('stale'),
      refreshAccessToken: () => {
        refreshes += 1;
        return Promise.resolve('fresh');
      },
    });

    const result = await withFetch(mockFetch, () => model.run(baseInput()));

    assertEq(refreshes, 1, 'the token is refreshed exactly once');
    assertEq(bearers.length, 2, 'the request is retried once');
    assertEq(bearers[0], 'Bearer stale', 'the first attempt carries the stale token');
    assertEq(bearers[1], 'Bearer fresh', 'the retry carries the refreshed token');
    assertEq(result.kind, 'final', 'the run succeeds after the refresh');
  }

  console.log('\nrefresh that cannot help:');
  {
    let attempts = 0;
    const mockFetch: FetchMock = async () => {
      attempts += 1;
      return new Response(
        JSON.stringify({ message: 'Token is invalid or expired' }),
        { status: 401 },
      );
    };

    // A refresh that yields nothing means the session is genuinely over. The
    // 401 must surface rather than being retried into a loop.
    const model = createRemoteAgentModel({
      baseUrl: 'http://test',
      getAccessToken: () => Promise.resolve('stale'),
      refreshAccessToken: () => Promise.resolve(null),
    });

    let code: string | null = null;
    try {
      await withFetch(mockFetch, () => model.run(baseInput()));
    } catch (error) {
      code = error instanceof AgentError ? error.code : 'unknown';
    }
    assertEq(code, 'AUTH_REQUIRED', 'a failed refresh still reports AUTH_REQUIRED');
    assertEq(attempts, 1, 'no retry is attempted when the refresh yields nothing');
  }

  console.log('\nunauthenticated 401:');
  {
    let refreshes = 0;
    const mockFetch: FetchMock = async () =>
      new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });

    // No token was sent, so there is nothing to refresh; refreshing here would
    // burn the refresh token on a request that was never authenticated.
    const model = createRemoteAgentModel({
      baseUrl: 'http://test',
      getAccessToken: () => Promise.resolve(null),
      refreshAccessToken: () => {
        refreshes += 1;
        return Promise.resolve('fresh');
      },
    });

    try {
      await withFetch(mockFetch, () => model.run(baseInput()));
    } catch {
      // Expected.
    }
    assertEq(refreshes, 0, 'a 401 without a token does not trigger a refresh');
  }

  console.log('verify:remote-agent — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
