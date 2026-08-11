/**
 * Remote agent wire-contract tests.
 *
 * Verifies the request shape, response parsing, error handling and Zod
 * validation of the POST /agent/step adapter.
 *
 * Run: npm run verify:remote-agent
 */
import { createRemoteAgentModel } from '../src/agent/models/remoteAgentModel.js';
import { AgentError } from '../src/agent/types.js';
import type { AgentModelInput } from '../src/agent/types.js';
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
      { id: 'msg_1', role: 'user', content: 'Find Daniyar in Telegram' },
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
        JSON.stringify({ result: { kind: 'final', text: 'ok' } }),
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
        JSON.stringify({ result: { kind: 'final', text: 'Done' } }),
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
        JSON.stringify({
          result: {
            kind: 'tool_calls',
            text: null,
            toolCalls: [
              {
                id: 'call_1',
                toolName: 'telegram.user.search_chats',
                args: { connectionId: 'telegram-user-test', query: 'Daniyar' },
              },
            ],
          },
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
  // D. Error responses
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
  // D2. Invalid JSON / schema — MODEL_ERROR
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

  console.log('verify:remote-agent — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
