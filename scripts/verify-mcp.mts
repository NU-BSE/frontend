/**
 * End-to-end check of the in-process MCP runtime.
 *
 * Proves the minimal path:
 * MCP Client → InMemoryTransport → MCP Server → connector → structured result.
 *
 * Run: npm run verify:mcp
 */
import {
  closeLocalMcpRuntime,
  getLocalMcpRuntime,
} from '../src/mcp/runtime-singleton.js';
import { runMcpSpike } from '../src/mcp/run-mcp-spike.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
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
