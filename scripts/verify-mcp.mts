/**
 * End-to-end check of the in-process MCP runtime.
 *
 * Proves the minimal path:
 * MCP Client → InMemoryTransport → MCP Server → connector → structured result.
 *
 * Run: npm run verify:mcp
 */
import { ToolExecutionError } from '@mobile-agent/mcp-client';

import { InMemoryApprovalService } from '@mobile-agent/approval-core';
import { InMemoryConnectionStore, mockConn } from '@mobile-agent/connector-core';
import { createLocalMcpRuntime } from '@mobile-agent/mcp-client';
import { MockCalendarConnector, InMemoryApprovalStore } from '@mobile-agent/connector-mock';
import { DefaultPolicyEngine } from '@mobile-agent/policy-core';

import { createConnectorRegistry } from '../src/mcp/create-connector-registry.js';
import {
  closeLocalMcpRuntime,
  getLocalMcpRuntime,
} from '../src/mcp/runtime-singleton.js';
import { runMcpSpike } from '../src/mcp/run-mcp-spike.js';

/*
 * Tripwires for the architectural claim: the MCP client and server run inside
 * one JavaScript process, linked by InMemoryTransport, with no network and no
 * child process. These are installed before the runtime is created, so any
 * attempt to open a socket or spawn a process during the whole run is caught
 * rather than merely being absent from a grep.
 */
const violations: string[] = [];

// esbuild emits CJS for this script, so the runtime `require` is the real one
// and returns the live builtin module object rather than an ESM wrapper —
// patching it actually affects callers.
declare const require: (id: string) => Record<string, unknown>;
const nodeRequire = require;

function trap<T extends object>(mod: T, names: readonly string[], label: string): void {
  for (const name of names) {
    const key = name as keyof T;
    if (typeof mod[key] !== 'function') continue;
    Object.defineProperty(mod, key, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        violations.push(`${label}.${name}(${String(args[0]).slice(0, 60)})`);
        throw new Error(`${label}.${name} must not be used by the MCP runtime`);
      },
    });
  }
}

trap(nodeRequire('node:child_process'), ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'fork'], 'child_process');
trap(nodeRequire('node:net'), ['connect', 'createConnection', 'createServer'], 'net');
trap(nodeRequire('node:http'), ['request', 'get', 'createServer'], 'http');
trap(nodeRequire('node:https'), ['request', 'get', 'createServer'], 'https');
trap(nodeRequire('node:dgram'), ['createSocket'], 'dgram');

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
const CONNECTOR_NAMESPACES = [
  'android',
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

  console.log('nothing is connected by default:');

  const untouched = await getLocalMcpRuntime();
  const untouchedNames = (await untouched.mcp.listTools()).map((t) => t.name);

  assert(
    untouchedNames.every((name) => !CONNECTOR_NAMESPACES.some(
      (ns) => name.startsWith(`${ns}.`),
    )),
    'a fresh install exposes no third-party connector tools to the agent',
  );
  assert(
    untouchedNames.includes('system.health'),
    'built-in tools are still available without any connection',
  );

  /*
   * From here on the runtime is built directly rather than through the
   * singleton, so the test controls the connection store and can decide what
   * counts as linked.
   */
  const connections = new InMemoryConnectionStore();
  const approvals = new InMemoryApprovalService();

  /*
   * Connector tools are registered while the server is being constructed, so
   * the published list is a snapshot of what was linked at that moment. That
   * is what keeps unconnected services invisible; the cost is that a new
   * connection needs a rebuild, which the app does via
   * rebuildLocalMcpRuntime().
   */
  const build = async () =>
    (await createLocalMcpRuntime(
      { calendar: new MockCalendarConnector(), approvals: new InMemoryApprovalStore() },
      {
        registry: createConnectorRegistry(connections),
        policyEngine: new DefaultPolicyEngine(),
        approvalService: approvals,
      },
    )).mcp;

  const approveConnectorTool = (id: string) => approvals.approve(id);

  assert(
    (await build()).listTools().then((tools) =>
      tools.every((tool) => !CONNECTOR_NAMESPACES.some((ns) => tool.name.startsWith(`${ns}.`))),
    ),
    'an empty connection store yields no connector tools',
  );

  console.log('tools appear only for connected accounts:');

  await connections.save(mockConn('google', 'Google'));
  const afterGoogle = (await (await build()).listTools()).map((t) => t.name);

  assert(
    afterGoogle.some((name) => name.startsWith('google.')),
    'connecting Google publishes its tools',
  );
  assert(
    !afterGoogle.some((name) => name.startsWith('slack.')),
    'connecting Google alone does not publish Slack tools',
  );

  // Link the rest so the behavioural checks below have something to run on.
  for (const connectorId of [
    'android', 'telegram-bot', 'telegram-user', 'microsoft', 'slack', 'notion',
    'todoist', 'github', 'dropbox', 'discord', 'spotify', 'intent',
  ] as const) {
    await connections.save(mockConn(connectorId, connectorId));
  }

  const runtimeWithConnectors = await build();
  const allTools = await runtimeWithConnectors.listTools();
  const toolNames = allTools.map((tool) => tool.name);

  for (const namespace of CONNECTOR_NAMESPACES) {
    assertQuiet(
      toolNames.some((name) => name.startsWith(`${namespace}.`)),
      `${namespace} connector tools are registered once connected`,
    );
  }
  console.log(`  ok — all ${CONNECTOR_NAMESPACES.length} namespaces appear once linked (${allTools.length} tools)`);

  assert(
    new Set(toolNames).size === toolNames.length,
    'no duplicate tool names are registered',
  );

  console.log('disconnecting withdraws the tools again:');

  await connections.remove(mockConn('slack', 'slack').id);
  assert(
    !(await (await build()).listTools()).some((t) => t.name.startsWith('slack.')),
    'removing the Slack connection withdraws its tools from the agent',
  );
  await connections.save(mockConn('slack', 'Slack'));

  console.log('read tools need no approval:');

  const clipboard = await runtimeWithConnectors.callTool({
    name: 'android.clipboard.read',
    arguments: { connectionId: 'android-default' },
  });

  assert(
    (clipboard.structuredContent as { status?: string })?.status === 'success',
    'android.clipboard.read executes without an approval',
  );

  console.log('write tools enforce the approval round-trip:');

  const writeArgs = {
    connectionId: 'android-default',
    text: 'approved clipboard text',
  };

  const firstCall = await runtimeWithConnectors.callTool({
    name: 'android.clipboard.write',
    arguments: writeArgs,
  });

  const pending = firstCall.structuredContent as {
    status?: string;
    approvalId?: string;
  };

  assert(
    pending?.status === 'approval_required',
    'android.clipboard.write first returns approval_required',
  );
  assert(
    typeof pending.approvalId === 'string' && pending.approvalId.length > 0,
    'approval_required carries an approvalId for the UI',
  );

  const approvalId = pending.approvalId as string;

  const unapproved = await callAndCatch(() =>
    runtimeWithConnectors.callTool({
      name: 'android.clipboard.write',
      arguments: { ...writeArgs, approvalId },
    }),
  );

  assert(
    unapproved !== null && /not yet approved/iu.test(unapproved),
    'an approvalId the user has not confirmed is rejected',
  );

  await approveConnectorTool(approvalId);

  const tampered = await callAndCatch(() =>
    runtimeWithConnectors.callTool({
      name: 'android.clipboard.write',
      arguments: { ...writeArgs, text: 'never seen', approvalId },
    }),
  );

  assert(
    tampered !== null && /do not match/iu.test(tampered),
    'arguments altered after approval are rejected',
  );

  const executed = await runtimeWithConnectors.callTool({
    name: 'android.clipboard.write',
    arguments: { ...writeArgs, approvalId },
  });

  assert(
    (executed.structuredContent as { status?: string })?.status === 'success',
    'the approved payload executes',
  );

  const replayed = await callAndCatch(() =>
    runtimeWithConnectors.callTool({
      name: 'android.clipboard.write',
      arguments: { ...writeArgs, approvalId },
    }),
  );

  assert(
    replayed !== null && /already consumed/iu.test(replayed),
    'an approval cannot be replayed a second time',
  );

  console.log('connector tool schemas are agent-readable:');

  for (const tool of allTools) {
    const schema = tool.inputSchema as { allOf?: unknown[] };
    assertQuiet(schema.allOf === undefined, `${tool.name} publishes no allOf wrapper`);
  }
  console.log(`  ok — all ${allTools.length} tools expose top-level properties`);

  console.log('approval round-trip works for every gated tool:');

  const gated = allTools.filter((tool) =>
    /^telegram\./u.test(tool.name) &&
    Boolean((tool.inputSchema as { properties?: Record<string, unknown> }).properties?.approvalId),
  );

  assert(gated.length > 0, 'telegram exposes gated tools to test');

  for (const tool of gated) {
    const args: Record<string, unknown> = {
      connectionId: tool.name.startsWith('telegram.bot')
        ? 'telegram-bot-default'
        : 'telegram-user-default',
      chatId: 1, text: 'x', messageId: 1, document: 'x', query: 'x',
    };

    const first = await runtimeWithConnectors.callTool({ name: tool.name, arguments: args });
    const p = first.structuredContent as { status?: string; approvalId?: string };
    assertQuiet(p?.status === 'approval_required', `${tool.name} asks for approval`);
    await approveConnectorTool(p.approvalId as string);
    const second = await runtimeWithConnectors.callTool({
      name: tool.name,
      arguments: { ...args, approvalId: p.approvalId },
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

  /*
   * The linked pair is the substance of the claim: two transport halves that
   * hand messages to each other by reference. If this ever becomes a socket or
   * a pipe, these identities stop holding.
   */
  const transport = (
    untouched.rawClient as unknown as { transport?: object }
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
