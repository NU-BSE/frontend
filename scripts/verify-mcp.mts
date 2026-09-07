/**
 * End-to-end check of the in-process MCP runtime.
 *
 * Proves the minimal path:
 * MCP Client → InMemoryTransport → MCP Server → connector → structured result.
 *
 * Run: npm run verify:mcp
 */
import { ToolExecutionError } from '@mobile-agent/mcp-client';

import {
  approveConnectorTool,
  closeLocalMcpRuntime,
  getConnectionStore,
  getCredentialVault,
  getLocalMcpRuntime,
  restartLocalMcpRuntime,
} from '../src/mcp/runtime-singleton.js';
import { TELEGRAM_USER_SCOPES } from '@mobile-agent/connector-telegram';
import { runMcpSpike } from '../src/mcp/run-mcp-spike.js';

const violations: string[] = [];

declare const require: (id: string) => Record<string, unknown>;

function trap(mod: Record<string, unknown>, names: readonly string[], label: string): void {
  for (const name of names) {
    if (typeof mod[name] !== 'function') continue;
    Object.defineProperty(mod, name, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        violations.push(`${label}.${name}(${String(args[0]).slice(0, 60)})`);
        throw new Error(`${label}.${name} must not be used by the MCP runtime`);
      },
    });
  }
}

trap(require('node:child_process'), ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'fork'], 'child_process');
trap(require('node:net'), ['connect', 'createConnection', 'createServer'], 'net');
trap(require('node:http'), ['request', 'get', 'createServer'], 'http');
trap(require('node:https'), ['request', 'get', 'createServer'], 'https');
trap(require('node:dgram'), ['createSocket'], 'dgram');

const globals = globalThis as Record<string, unknown>;
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
  if (typeof globals[name] === 'undefined') continue;
  globals[name] = (...args: unknown[]) => {
    violations.push(`${name}(${String(args[0]).slice(0, 60)})`);
    throw new Error(`${name} must not be used by the MCP runtime`);
  };
}

const startingPid = process.pid;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function assertQuiet(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

process.env.EXPO_PUBLIC_TELEGRAM_ADAPTER = 'mock';

/**
 * Account namespaces available in Node development.
 *
 * This list used to carry eight more — microsoft, slack, notion, todoist,
 * github, dropbox, discord, spotify — and they have been deleted from
 * `create-connector-registry.ts`, mock implementations that answered from
 * fixtures and cost the local planner most of a 7,000-token prompt. Android
 * and Intent are real but native-bridge-gated, so they never register here.
 */
const CONNECTOR_NAMESPACES = ['google', 'telegram'];

async function callAndCatch(
  call: () => Promise<unknown>,
): Promise<string | null> {
  try {
    await call();
    return null;
  } catch (error) {
    if (error instanceof ToolExecutionError) return error.message;
    throw error;
  }
}

async function main(): Promise<void> {
  console.log('local MCP runtime:');

  const first = getLocalMcpRuntime();
  const second = getLocalMcpRuntime();
  assert(first === second, 'runtime is created once (singleton)');

  const result = await runMcpSpike();

  assert(result.health.status === 'ok', 'system.health returns status ok');
  assert(result.toolNames.includes('system.health'), 'listTools contains system.health');
  assert(result.toolNames.includes('calendar.list_events'), 'listTools contains calendar.list_events');
  assert(result.toolNames.includes('calendar.create_event'), 'listTools contains calendar.create_event');
  assert(result.events.some((event) => event.id === 'event-1'), 'calendar.list_events returns the mock event');
  assert(result.createdEventTitle === 'MCP spike event', 'calendar.create_event creates an event after approval');
  assert(result.invalidRangeRejected, 'invalid date range returns a tool error');

  console.log('connector tools:');

  const connectionStore = getConnectionStore();
  const credentialVault = getCredentialVault();
  for (const namespace of CONNECTOR_NAMESPACES) {
    const connectorId = namespace === 'telegram' ? 'telegram-user' : namespace;
    const now = Date.now();
    const scopes =
      connectorId === 'telegram-user'
        ? [...TELEGRAM_USER_SCOPES]
        : [`${connectorId}.read`, `${connectorId}.write`];

    /*
     * With a credential, because the runtime now demotes any external account
     * marked `connected` that has none. These records used to have none and
     * kept their tools, which is exactly how a seeded fixture made Google look
     * signed in on a fresh install. A test connection has to be as real as the
     * thing it stands in for.
     */
    const credentialReference = `secret:${connectorId}-verify`;
    await credentialVault.save(credentialReference, {
      kind: 'static_token',
      token: 'verification',
    });

    await connectionStore.save({
      id: `${connectorId}-verify`,
      connectorId: connectorId as never,
      displayName: `${connectorId} (verification)`,
      status: 'connected',
      scopes,
      capabilities: scopes,
      credentialReference,
      createdAt: now,
      updatedAt: now,
    });
  }
  await restartLocalMcpRuntime();

  const runtimeWithConnectors = await getLocalMcpRuntime();
  const allTools = await runtimeWithConnectors.mcp.listTools();
  const toolNames = allTools.map((tool) => tool.name);

  for (const namespace of CONNECTOR_NAMESPACES) {
    assert(
      toolNames.some((name) => name.startsWith(`${namespace}.`)),
      `${namespace} connector tools are registered`,
    );
  }
  assert(
    !toolNames.some((name) => name.startsWith('intent.')),
    'native Android intent tools are not faked in the Node verification runtime',
  );

  assert(new Set(toolNames).size === toolNames.length, 'no duplicate tool names are registered');

  // Notion used to be the vehicle for the approval round-trip below. It was a
  // mock connector and is gone; Telegram over the mock TDLib adapter carries
  // the same shape — a `read` tool and an `external_side_effect` tool — and is
  // a connector the app actually ships.
  const TELEGRAM_CONNECTION = 'telegram-user-verify';

  console.log('read tools need no approval:');

  const chats = await runtimeWithConnectors.mcp.callTool({
    name: 'telegram.user.search_chats',
    arguments: { connectionId: TELEGRAM_CONNECTION, query: 'a' },
  });

  assert(
    (chats.structuredContent as { status?: string })?.status === 'success',
    'telegram.user.search_chats executes without an approval',
  );

  console.log('write tools enforce the approval round-trip:');

  const writeArgs = {
    connectionId: TELEGRAM_CONNECTION,
    chatId: '1',
    text: 'approved message',
  };

  const firstCall = await runtimeWithConnectors.mcp.callTool({
    name: 'telegram.user.send_message',
    arguments: writeArgs,
  });

  const pending = firstCall.structuredContent as {
    status?: string;
    approvalId?: string;
  };

  assert(
    pending?.status === 'approval_required',
    'telegram.user.send_message first returns approval_required',
  );
  assert(
    typeof pending.approvalId === 'string' && pending.approvalId.length > 0,
    'approval_required carries an approvalId for the UI',
  );

  const approvalId = pending.approvalId as string;

  const unapproved = await callAndCatch(() =>
    runtimeWithConnectors.mcp.callTool({
      name: 'telegram.user.send_message',
      arguments: { ...writeArgs, approvalId },
    }),
  );
  assert(unapproved !== null && /not yet approved/iu.test(unapproved), 'an unconfirmed approvalId is rejected');

  await approveConnectorTool(approvalId);

  const tampered = await callAndCatch(() =>
    runtimeWithConnectors.mcp.callTool({
      name: 'telegram.user.send_message',
      arguments: {
        ...writeArgs,
        text: 'something the user never saw',
        approvalId,
      },
    }),
  );
  assert(tampered !== null && /do not match/iu.test(tampered), 'arguments altered after approval are rejected');

  const executed = await runtimeWithConnectors.mcp.callTool({
    name: 'telegram.user.send_message',
    arguments: { ...writeArgs, approvalId },
  });
  assert((executed.structuredContent as { status?: string })?.status === 'success', 'the approved payload executes');

  const replayed = await callAndCatch(() =>
    runtimeWithConnectors.mcp.callTool({
      name: 'telegram.user.send_message',
      arguments: { ...writeArgs, approvalId },
    }),
  );
  assert(replayed !== null && /already consumed/iu.test(replayed), 'an approval cannot be replayed');

  console.log('connector tool schemas are agent-readable:');
  for (const tool of allTools) {
    const schema = tool.inputSchema as {
      properties?: Record<string, unknown>;
      allOf?: unknown[];
    };
    assertQuiet(schema.allOf === undefined, `${tool.name} publishes no allOf wrapper`);
  }
  console.log(`  ok — all ${allTools.length} tools expose top-level properties`);

  console.log('approval round-trip works for every gated tool:');
  const gated = allTools.filter((tool) =>
    /^telegram\./u.test(tool.name) &&
    Boolean(
      (tool.inputSchema as { properties?: Record<string, unknown> })
        .properties?.approvalId,
    ),
  );

  assert(gated.length > 0, 'telegram exposes gated tools to test');

  for (const tool of gated) {
    const args: Record<string, unknown> = {
      // The connection this test created, not a fixture the runtime used to
      // seed. `telegram-user-default` was one of those and is gone.
      connectionId: 'telegram-user-verify',
      chatId: '1',
      text: 'x',
      messageId: 1,
      document: 'x',
      query: 'x',
    };

    const firstApproval = await runtimeWithConnectors.mcp.callTool({
      name: tool.name,
      arguments: args,
    });
    const pendingApproval = firstApproval.structuredContent as {
      status?: string;
      approvalId?: string;
    };
    assertQuiet(pendingApproval?.status === 'approval_required', `${tool.name} asks for approval`);

    await approveConnectorTool(pendingApproval.approvalId as string);

    const secondApproval = await runtimeWithConnectors.mcp.callTool({
      name: tool.name,
      arguments: { ...args, approvalId: pendingApproval.approvalId },
    });
    assertQuiet(
      (secondApproval.structuredContent as { status?: string })?.status === 'success',
      `${tool.name} executes once approved (did not loop)`,
    );
  }
  console.log(`  ok — ${gated.length} composed-schema tools complete the round-trip`);

  console.log('architecture: one process, in-memory transport:');
  assert(violations.length === 0, 'no network call or process spawn occurred during the entire run');
  assert(process.pid === startingPid, 'client and server ran in the same process (pid unchanged)');

  const transport = (
    runtimeWithConnectors.rawClient as unknown as { transport?: object }
  ).transport;
  assert(transport !== undefined && transport !== null, 'the client is connected through a transport object');
  assert(
    typeof (transport as { start?: unknown }).start === 'function',
    'the transport is a real Transport instance, not a stub',
  );

  console.log('runtime shutdown:');
  await closeLocalMcpRuntime();

  const runtime = await getLocalMcpRuntime();
  const health = await runtime.mcp.health();
  assert(health.status === 'ok', 'runtime re-initializes after close');

  await closeLocalMcpRuntime();
  console.log('MCP spike: all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
