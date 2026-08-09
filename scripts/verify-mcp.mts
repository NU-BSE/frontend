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
  getLocalMcpRuntime,
} from '../src/mcp/runtime-singleton.js';
import { runMcpSpike } from '../src/mcp/run-mcp-spike.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
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

  console.log('connector tools:');

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

  const clipboard = await runtimeWithConnectors.mcp.callTool({
    name: 'android.clipboard.read',
    arguments: { connectionId: 'android-device' },
  });

  assert(
    (clipboard.structuredContent as { status?: string })?.status === 'success',
    'android.clipboard.read executes without an approval',
  );

  console.log('write tools enforce the approval round-trip:');

  const writeArgs = {
    connectionId: 'android-device',
    text: 'approved clipboard text',
  };

  const firstCall = await runtimeWithConnectors.mcp.callTool({
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
    runtimeWithConnectors.mcp.callTool({
      name: 'android.clipboard.write',
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
      name: 'android.clipboard.write',
      arguments: {
        ...writeArgs,
        text: 'something the user never saw',
        approvalId,
      },
    }),
  );

  assert(
    tampered !== null && /do not match/iu.test(tampered),
    'arguments altered after approval are rejected',
  );

  const executed = await runtimeWithConnectors.mcp.callTool({
    name: 'android.clipboard.write',
    arguments: { ...writeArgs, approvalId },
  });

  assert(
    (executed.structuredContent as { status?: string })?.status === 'success',
    'the approved payload executes',
  );

  const replayed = await callAndCatch(() =>
    runtimeWithConnectors.mcp.callTool({
      name: 'android.clipboard.write',
      arguments: { ...writeArgs, approvalId },
    }),
  );

  assert(
    replayed !== null && /already consumed/iu.test(replayed),
    'an approval cannot be replayed a second time',
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
