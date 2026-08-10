import type { AgentToolDefinition } from './types';

interface McpToolShape {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

function riskFromAnnotations(
  annotations: McpToolShape['annotations'],
): AgentToolDefinition['risk'] {
  if (!annotations) return undefined;
  // MCP annotations are hints, not guarantees — map them conservatively.
  if (annotations.destructiveHint) return 'destructive';
  // readOnlyHint=true means no side effects, but some write/external_side_effect
  // tools may not declare it. Tools without readOnlyHint default to potentially
  // write (the policy/approval layer handles the actual gating).
  if (annotations.readOnlyHint) return 'read';
  return undefined;
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
    risk: riskFromAnnotations(tool.annotations),
  }));
}
