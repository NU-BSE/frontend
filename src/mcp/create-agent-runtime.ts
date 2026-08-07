import * as z from 'zod/v4';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';

import { DefaultPolicyEngine } from '@mobile-agent/policy-core';
import { InMemoryApprovalService } from '@mobile-agent/approval-core';
import { registerConnectorTools } from '@mobile-agent/mcp-server';

import { createConnectorRegistry } from './create-connector-registry';

export async function createAgentRuntime() {
  const registry = createConnectorRegistry();
  const policyEngine = new DefaultPolicyEngine();
  const approvalService = new InMemoryApprovalService();

  const server = new McpServer({
    name: 'mobile-agent-local-server',
    version: '0.2.0',
  });

  // System health
  server.registerTool('system.health', {
    description: 'Check whether the local MCP server is running',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  } as any, async () => ({
    content: [{ type: 'text' as const, text: 'Local MCP server is running' }],
    structuredContent: { status: 'ok', timestamp: new Date().toISOString() },
  }));

  // Dynamic tools from all connectors
  await registerConnectorTools(server, registry, policyEngine, approvalService);

  const client = new Client({
    name: 'mobile-agent-client',
    version: '0.2.0',
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { server, client, registry, policyEngine, approvalService };
}
