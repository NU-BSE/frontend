// A real, minimal stdio MCP server used by the toolset integration test.
// stdout carries only MCP protocol bytes; all logs go to stderr.
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const server = new McpServer({
  name: 'mock-mcp-server',
  version: '1.0.0',
  description: 'Fixture stdio MCP server used by tests',
});

server.registerTool(
  'fixture.echo',
  {
    description: 'Echo the provided text back',
    inputSchema: z.object({
      text: z.string().min(1).max(1000),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ text }) => ({
    content: [{ type: 'text', text: `echo: ${text}` }],
  }),
);

server.registerTool(
  'fixture.answer',
  {
    description: 'Return the answer to everything',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => ({
    content: [{ type: 'text', text: '42' }],
  }),
);

process.stderr.write('[mock-mcp-server] starting over stdio\n');
await server.connect(new StdioServerTransport());
process.stderr.write('[mock-mcp-server] ready\n');