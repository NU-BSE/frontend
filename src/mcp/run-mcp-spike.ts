import { ToolExecutionError } from '@mobile-agent/mcp-client';

import {
  getLocalMcpRuntime,
  issueToolApproval,
} from './runtime-singleton';

export interface McpSpikeEvent {
  id: string;
  connectionId: string;
  title: string;
  start: string;
  end: string;
}

export interface McpSpikeResult {
  health: { status: 'ok'; timestamp: string };
  toolNames: string[];
  events: McpSpikeEvent[];
  createdEventTitle: string;
  invalidRangeRejected: boolean;
}

/**
 * Compatibility spike для проверки MCP runtime:
 * Android app → MCP Client → InMemoryTransport → MCP Server → tool → structured result.
 *
 * Временно вызывается из debug-кнопки в development build.
 */
export async function runMcpSpike(): Promise<McpSpikeResult> {
  const runtime = await getLocalMcpRuntime();

  const health = await runtime.mcp.health();

  const tools = await runtime.mcp.listTools();

  const events = await runtime.mcp.listCalendarEvents({
    connectionId: 'mock-personal',
    start: '2026-08-07T00:00:00+05:00',
    end: '2026-08-08T00:00:00+05:00',
  });

  const createPayload = {
    connectionId: 'mock-personal',
    title: 'MCP spike event',
    start: '2026-08-08T10:00:00+05:00',
    end: '2026-08-08T11:00:00+05:00',
  };

  const approvalId = issueToolApproval({
    toolName: 'calendar.create_event',
    payload: createPayload,
  });

  const created = await runtime.mcp.createCalendarEvent({
    ...createPayload,
    approvalId,
    idempotencyKey: 'spike-create-1',
  });

  let invalidRangeRejected = false;

  try {
    await runtime.mcp.listCalendarEvents({
      connectionId: 'mock-personal',
      start: '2026-08-08T00:00:00+05:00',
      end: '2026-08-07T00:00:00+05:00',
    });
  } catch (error) {
    if (error instanceof ToolExecutionError) {
      invalidRangeRejected = true;
    } else {
      throw error;
    }
  }

  return {
    health,
    toolNames: tools.map((tool) => tool.name),
    events: events.events.map((event) => ({
      id: event.id,
      connectionId: event.connectionId,
      title: event.title,
      start: event.start,
      end: event.end,
    })),
    createdEventTitle: created.event.title,
    invalidRangeRejected,
  };
}
