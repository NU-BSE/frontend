import type { AgentToolDefinition } from './types';

interface McpToolShape {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * Maps MCP tool definitions into the format the agent model consumes.
 * The JSON Schema is passed through untouched — it is what the MCP server
 * validates against, so the model and the executor can never disagree about
 * the shape of arguments.
 */
export function mapMcpTools(
  tools: McpToolShape[],
): AgentToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description ?? '',
    inputSchema:
      typeof tool.inputSchema === 'object' && tool.inputSchema !== null
        ? (tool.inputSchema as Record<string, unknown>)
        : { type: 'object', properties: {} },
  }));
}
