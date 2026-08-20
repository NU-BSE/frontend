import * as z from 'zod/v4';
import { ConnectorError, type ConnectorTool } from '@mobile-agent/connector-core';

import { closeTestRuntimes, fakeConnector, startRuntime } from './mcp-test-helpers';

afterEach(async () => {
  await closeTestRuntimes();
});

const CONNECTION = {
  id: 'fake-conn',
  connectorId: 'fake' as const,
  displayName: 'Fake',
  status: 'connected' as const,
  scopes: [],
  capabilities: [],
  createdAt: 0,
  updatedAt: 0,
};

function readTool(): ConnectorTool {
  return {
    name: 'fake.read',
    title: 'Read',
    description: 'Read',
    inputSchema: z.object({ connectionId: z.string().min(1) }),
    outputSchema: z.object({ value: z.number() }),
    risk: 'read',
    capabilities: [],
    requiredScopes: [],
    implementationStatus: 'real',
    execute: async () => ({ value: 123 }),
  };
}

describe('MCP output schema (protocol envelope)', () => {
  it('TEST A — read success passes output validation', async () => {
    const tool = readTool();
    const { runtime } = await startRuntime(
      fakeConnector('fake', [tool], CONNECTION),
    );

    const result = await runtime.mcp.callTool({
      name: 'fake.read',
      arguments: { connectionId: 'fake-conn' },
    });

    expect(result.structuredContent).toEqual({
      status: 'success',
      data: { value: 123 },
    });
  });

  it('TEST B — external side effect returns approval_required without executing', async () => {
    const execute = jest.fn(async () => ({ opened: true as const }));
    const tool: ConnectorTool = {
      name: 'fake.open',
      title: 'Open',
      description: 'Open',
      inputSchema: z.object({ connectionId: z.string().min(1) }),
      outputSchema: z.object({ opened: z.literal(true) }),
      risk: 'external_side_effect',
      capabilities: [],
      requiredScopes: [],
      implementationStatus: 'real',
      execute,
    };
    const { runtime } = await startRuntime(
      fakeConnector('fake', [tool], CONNECTION),
    );

    const result = await runtime.mcp.callTool({
      name: 'fake.open',
      arguments: { connectionId: 'fake-conn' },
    });

    expect(result.structuredContent).toMatchObject({
      status: 'approval_required',
      approvalId: expect.any(String),
      preview: expect.any(Object),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('TEST C — approved side effect returns success envelope', async () => {
    const tool: ConnectorTool = {
      name: 'fake.open',
      title: 'Open',
      description: 'Open',
      inputSchema: z.object({ connectionId: z.string().min(1) }),
      outputSchema: z.object({ opened: z.literal(true) }),
      risk: 'external_side_effect',
      capabilities: [],
      requiredScopes: [],
      implementationStatus: 'real',
      execute: async () => ({ opened: true as const }),
    };
    const { runtime, approvalService } = await startRuntime(
      fakeConnector('fake', [tool], CONNECTION),
    );

    const first = await runtime.mcp.callTool({
      name: 'fake.open',
      arguments: { connectionId: 'fake-conn' },
    });
    const approvalId = (first.structuredContent as { approvalId: string })
      .approvalId;

    await approvalService.approve(approvalId);

    const second = await runtime.mcp.callTool({
      name: 'fake.open',
      arguments: { connectionId: 'fake-conn', approvalId },
    });

    expect(second.structuredContent).toEqual({
      status: 'success',
      data: { opened: true },
    });
  });

  it('TEST D — OUTCOME_UNKNOWN passes output validation', async () => {
    const tool: ConnectorTool = {
      name: 'fake.read',
      title: 'Read',
      description: 'Read',
      inputSchema: z.object({ connectionId: z.string().min(1) }),
      outputSchema: z.object({ opened: z.literal(true) }),
      risk: 'read',
      capabilities: [],
      requiredScopes: [],
      implementationStatus: 'real',
      execute: async () => {
        throw new ConnectorError('Outcome could not be confirmed', 'OUTCOME_UNKNOWN');
      },
    };
    const { runtime } = await startRuntime(
      fakeConnector('fake', [tool], CONNECTION),
    );

    const result = await runtime.mcp.callTool({
      name: 'fake.read',
      arguments: { connectionId: 'fake-conn' },
    });

    expect(result.structuredContent).toEqual({
      status: 'outcome_unknown',
      error: 'Outcome could not be confirmed',
    });
  });

  it('TEST E — invalid domain output is still caught by validation', async () => {
    const tool: ConnectorTool = {
      name: 'fake.read',
      title: 'Read',
      description: 'Read',
      inputSchema: z.object({ connectionId: z.string().min(1) }),
      outputSchema: z.object({ opened: z.boolean() }),
      risk: 'read',
      capabilities: [],
      requiredScopes: [],
      implementationStatus: 'real',
      // Returns a payload that does not match the declared output schema.
      execute: async () => ({ wrong: true }),
    };
    const { runtime } = await startRuntime(
      fakeConnector('fake', [tool], CONNECTION),
    );

    await expect(
      runtime.mcp.callTool({
        name: 'fake.read',
        arguments: { connectionId: 'fake-conn' },
      }),
    ).rejects.toThrow(/Output validation error/i);
  });
});
