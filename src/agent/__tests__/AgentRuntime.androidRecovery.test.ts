import type { AgentMcpClient } from '@mobile-agent/mcp-client';

import { AgentRuntime } from '@/agent/AgentRuntime';
import { createScriptedPlanner } from '@/agent/models/deterministicPlanner';
import type { AgentModelResult, AgentToolCall } from '@/agent/types';

const ANDROID = {
  id: 'android-device',
  provider: 'android',
  displayName: 'This device',
  capabilities: [
    'android.settings.navigation',
    'android.usage.read',
    'android.assistant.read',
    'android.assistant.manage',
    'android.assistant.screen_context',
  ],
};

function toolCall(toolName: string, args: Record<string, unknown> = {}): AgentModelResult {
  return {
    kind: 'tool_calls',
    toolCalls: [{ id: 'model-call', toolName, args } as AgentToolCall],
  };
}

function success(data: unknown) {
  return {
    content: [],
    structuredContent: { status: 'success', data },
  };
}

function tools(names: string[]) {
  return names.map((name) => ({
    name,
    description: '',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  }));
}

describe('AgentRuntime Android recovery', () => {
  it('opens Usage access, refreshes scopes, then performs the query', async () => {
    const calls: { name: string; arguments?: Record<string, unknown> }[] = [];
    let plannerCalls = 0;
    const mcp = {
      listTools: async () =>
        tools(['android.usage.recent', 'android.settings.open']),
      callTool: async (request: {
        name: string;
        arguments?: Record<string, unknown>;
      }) => {
        calls.push(request);
        return request.name === 'android.usage.recent'
          ? success({ available: true, events: [] })
          : success({ opened: true, screen: 'usageAccess' });
      },
    } as AgentMcpClient;

    const runtime = new AgentRuntime({
      model: createScriptedPlanner(() => {
        plannerCalls += 1;
        return plannerCalls === 1
          ? toolCall('android.usage.recent', { days: 7 })
          : { kind: 'final', text: 'Done.' };
      }),
      mcp,
      connections: [ANDROID],
      connectionScopes: { 'android-device': [] },
      refreshConnections: async () => ({
        connections: [ANDROID],
        connectionScopes: {
          'android-device': ['android.usage.read'],
        },
      }),
      approveApproval: async () => undefined,
    });

    await runtime.sendMessage('What apps did I use?');

    expect(calls.map((call) => call.name)).toEqual([
      'android.settings.open',
      'android.usage.recent',
    ]);
    expect(calls[0]?.arguments).toEqual({
      connectionId: 'android-device',
      screen: 'usageAccess',
    });
    expect(calls[1]?.arguments).toEqual({
      connectionId: 'android-device',
      days: 7,
    });
  });

  it('requests the assistant role, refreshes status, and retries NOT_ALLOWED', async () => {
    const calls: string[] = [];
    let screenAttempts = 0;
    let plannerCalls = 0;
    const denied = new Error(
      '{"code":"NOT_ALLOWED","detail":"assistant role is required"}',
    );
    denied.name = 'ToolExecutionError';

    const mcp = {
      listTools: async () =>
        tools([
          'android.assistant.get_screen_context',
          'android.assistant.request_role',
          'android.assistant.get_status',
        ]),
      callTool: async (request: { name: string }) => {
        calls.push(request.name);
        if (
          request.name === 'android.assistant.get_screen_context' &&
          screenAttempts++ === 0
        ) {
          throw denied;
        }
        if (request.name === 'android.assistant.request_role') {
          return success({ granted: true, outcome: 'granted' });
        }
        if (request.name === 'android.assistant.get_status') {
          return success({ roleAvailable: true, isDefault: true, serviceReady: true });
        }
        return success({ available: true, lines: ['Settings'] });
      },
    } as AgentMcpClient;

    const runtime = new AgentRuntime({
      model: createScriptedPlanner(() => {
        plannerCalls += 1;
        return plannerCalls === 1
          ? toolCall('android.assistant.get_screen_context')
          : { kind: 'final', text: 'Done.' };
      }),
      mcp,
      connections: [ANDROID],
      refreshConnections: async () => ({
        connections: [ANDROID],
        connectionScopes: {},
      }),
      approveApproval: async () => undefined,
    });

    await runtime.sendMessage('What is on my screen?');

    expect(calls).toEqual([
      'android.assistant.get_screen_context',
      'android.assistant.request_role',
      'android.assistant.get_status',
      'android.assistant.get_screen_context',
    ]);
    const visibleErrors = runtime
      .getMessages()
      .filter((message) => message.role === 'tool')
      .map((message) => message.result.error)
      .filter(Boolean);
    expect(visibleErrors.join(' ')).not.toContain('NOT_ALLOWED');
    expect(visibleErrors.join(' ')).not.toContain('{');
  });

  it('shows a readable error without calling MCP when no Android device exists', async () => {
    let called = false;
    let plannerCalls = 0;
    const mcp = {
      listTools: async () => tools(['android.usage.recent']),
      callTool: async () => {
        called = true;
        return success({});
      },
    } as AgentMcpClient;
    const runtime = new AgentRuntime({
      model: createScriptedPlanner(() => {
        plannerCalls += 1;
        return plannerCalls === 1
          ? toolCall('android.usage.recent')
          : { kind: 'final', text: 'Could not read usage.' };
      }),
      mcp,
      connections: [],
      approveApproval: async () => undefined,
    });

    await runtime.sendMessage('What apps did I use?');

    expect(called).toBe(false);
    const result = runtime
      .getMessages()
      .find((message) => message.role === 'tool');
    expect(result?.role === 'tool' ? result.result.error : '').toContain(
      'No Android device is connected',
    );
  });
});
