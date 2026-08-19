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
  getLocalMcpRuntime,
  restartLocalMcpRuntime,
} from '../src/mcp/runtime-singleton.js';
import { TELEGRAM_USER_SCOPES } from '@mobile-agent/connector-telegram';
import { runMcpSpike } from '../src/mcp/run-mcp-spike.js';

/*
 * Tripwires for the architectural claim: the MCP client and server run inside
 * one JavaScript process, linked by InMemoryTransport, with no network and no
 * child process. Installed before the runtime is created, so any attempt to
 * open a socket or spawn a process during the whole run is caught rather than
 * merely being absent from a grep.
 */
const violations: string[] = [];

// esbuild emits CJS for this script, so the runtime `require` returns the live
// builtin module object rather than an ESM wrapper — patching it affects callers.
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

/** Same check, but silent on success — for assertions run in a loop. */
function assertQuiet(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

/** Every connector namespace that must reach the agent. */
/*
 * Node has no native TDLib, and the adapter now defaults to native everywhere
 * — a mock has to be asked for by name. This script asks. It exercises the
 * whole tool surface, including Telegram's, which needs an adapter that runs
 * off-device.
 */
process.env.EXPO_PUBLIC_TELEGRAM_ADAPTER = 'mock';

const CONNECTOR_NAMESPACES = [
  'google',
  'telegram',
  'microsoft',
  'slack',
  'notion',
  'todoist',
  'github',
  'dropbox',
  'discord',
  'spotify',
  'intent',
];

/**
 * Runs a tool and reports the failure message instead of throwing, so the
 * checks below can assert on *why* a call was rejected.
 */
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
  assert(
    result.toolNames.includes('system.health'),
    'listTools contains system.health',
  );
  assert(
    result.toolNames.includes('calendar.list_events'),
    'listTools contains calendar.list_events',
  );
  assert(
    result.toolNames.includes('calendar.create_event'),
    'listTools contains calendar.create_event',
  );
  assert(
    result.events.some((event) => event.id === 'event-1'),
    'calendar.list_events returns the mock event',
  );
  assert(
    result.createdEventTitle === 'MCP spike event',
    'calendar.create_event creates an event after approval',
  );
  assert(
    result.invalidRangeRejected,
    'invalid date range returns a tool error',
  );

  console.log('connector tools:');

  /*
   * Connect the accounts this section asserts on, instead of relying on the
   * runtime to have pre-connected them. It no longer does: only the device is
   * connected out of the box, because claiming a dozen linked accounts on a
   * fresh install was a lie the app told about the user's data. Tools follow
   * connections, so a test about tools has to make the connections.
   */
  const connectionStore = getConnectionStore();
  for (const namespace of CONNECTOR_NAMESPACES) {
    const connectorId = namespace === 'telegram' ? 'telegram-user' : namespace;
    if (connectorId === 'android') continue;
    const now = Date.now();
    // Telegram gates its send tool on a declared scope, so grant the ones the
    // connector publishes rather than a generic read/write pair.
    const scopes =
      connectorId === 'telegram-user'
        ? [...TELEGRAM_USER_SCOPES]
        : [`${connectorId}.read`, `${connectorId}.write`];
    await connectionStore.save({
      id: `${connectorId}-verify`,
      connectorId: connectorId as never,
      displayName: `${connectorId} (verification)`,
      status: 'connected',
      scopes,
      capabilities: scopes,
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
    new Set(toolNames).size === toolNames.length,
    'no duplicate tool names are registered',
  );

  console.log('read tools need no approval:');

  const page = await runtimeWithConnectors.mcp.callTool({
    name: 'notion.pages.get',
    arguments: { connectionId: 'notion-default' },
  });

  assert(
    (page.structuredContent as { status?: string })?.status === 'success',
    'notion.pages.get executes without an approval',
  );

  console.log('write tools enforce the approval round-trip:');

  const writeArgs = {
    connectionId: 'notion-default',
    parentId: 'p1',
    title: 'approved page',
  };

  const firstCall = await runtimeWithConnectors.mcp.callTool({
    name: 'notion.pages.create',
    arguments: writeArgs,
  });

  const pending = firstCall.structuredContent as {
    status?: string;
    approvalId?: string;
  };

  assert(
    pending?.status === 'approval_required',
    'notion.pages.create first returns approval_required',
  );
  assert(
    typeof pending.approvalId === 'string' && pending.approvalId.length > 0,
    'approval_required carries an approvalId for the UI',
  );

  const approvalId = pending.approvalId as string;

  const unapproved = await callAndCatch(() =>
    runtimeWithConnectors.mcp.callTool({
      name: 'notion.pages.create',
      arguments: { ...writeArgs, approvalId },
    }),
  );

  assert(
    unapproved !== null && /not yet approved/iu.test(unapproved),
    'an approvalId the user has not confirmed is rejected',
  );

  // Stands in for the user tapping "Confirm" in the approval sheet.
  await approveConnectorTool(approvalId);

  const tampered = await callAndCatch(() =>
    runtimeWithConnectors.mcp.callTool({
      name: 'notion.pages.create',
      arguments: {
        ...writeArgs,
        title: 'something the user never saw',
        approvalId,
      },
    }),
  );

  assert(
    tampered !== null && /do not match/iu.test(tampered),
    'arguments altered after approval are rejected',
  );

  const executed = await runtimeWithConnectors.mcp.callTool({
    name: 'notion.pages.create',
    arguments: { ...writeArgs, approvalId },
  });

  assert(
    (executed.structuredContent as { status?: string })?.status === 'success',
    'the approved payload executes',
  );

  const replayed = await callAndCatch(() =>
    runtimeWithConnectors.mcp.callTool({
      name: 'notion.pages.create',
      arguments: { ...writeArgs, approvalId },
    }),
  );

  assert(
    replayed !== null && /already consumed/iu.test(replayed),
    'an approval cannot be replayed a second time',
  );

  console.log('connector tool schemas are agent-readable:');

  /*
   * Every tool must publish its arguments as top-level `properties`. Telegram
   * previously composed schemas with `connId.and(...)`, which serialises to
   * JSON Schema `allOf` with nothing at the top level — a model doing
   * tool-calling cannot see the arguments at all.
   */
  for (const tool of allTools) {
    const schema = tool.inputSchema as {
      properties?: Record<string, unknown>;
      allOf?: unknown[];
    };
    assertQuiet(
      schema.allOf === undefined,
      `${tool.name} publishes no allOf wrapper`,
    );
  }
  console.log(`  ok — all ${allTools.length} tools expose top-level properties`);

  console.log('approval round-trip works for every gated tool:');

  /*
   * Regression for the approval loop: `approvalId` was only added to schemas
   * that had `.extend` (ZodObject). Composed schemas silently dropped it, so
   * the field never reached the handler and each confirmed call minted a new
   * approval instead of consuming the old one -- the tool could never run.
   */
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
      // Ids created by this script above, not seeded by the runtime.
      connectionId: tool.name.startsWith('telegram.bot')
        ? 'telegram-bot-verify'
        : 'telegram-user-verify',
      chatId: '1',
      text: 'x',
      messageId: 1,
      document: 'x',
      query: 'x',
    };

    const first = await runtimeWithConnectors.mcp.callTool({
      name: tool.name,
      arguments: args,
    });
    const pendingApproval = first.structuredContent as {
      status?: string;
      approvalId?: string;
    };

    assertQuiet(
      pendingApproval?.status === 'approval_required',
      `${tool.name} asks for approval`,
    );

    await approveConnectorTool(pendingApproval.approvalId as string);

    const second = await runtimeWithConnectors.mcp.callTool({
      name: tool.name,
      arguments: { ...args, approvalId: pendingApproval.approvalId },
    });

    assertQuiet(
      (second.structuredContent as { status?: string })?.status === 'success',
      `${tool.name} executes once approved (did not loop)`,
    );
  }
  console.log(`  ok — ${gated.length} composed-schema tools complete the round-trip`);

  console.log('architecture: one process, in-memory transport:');

  assert(
    violations.length === 0,
    'no network call or process spawn occurred during the entire run',
  );
  assert(
    process.pid === startingPid,
    'client and server ran in the same process (pid unchanged)',
  );

  const transport = (
    runtimeWithConnectors.rawClient as unknown as { transport?: object }
  ).transport;
  assert(
    transport !== undefined && transport !== null,
    'the client is connected through a transport object',
  );
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
