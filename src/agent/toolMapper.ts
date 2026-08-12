import type { AgentToolDefinition } from './types';
import { INTERNAL_TOOL_ARGUMENTS } from './internalToolFields';

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
 * Produces a model-safe copy of a JSON Schema by stripping protocol-only
 * fields (`approvalId`, ...) from every `properties` object and filtering them
 * from `required` arrays. The original schema is never mutated; the MCP server
 * still accepts these fields, but the model must never see or set them.
 */
export function toModelVisibleSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return stripInternalFields(schema) as Record<string, unknown>;
}

function stripInternalFields(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripInternalFields);
  if (typeof node !== 'object' || node === null) return node;

  const record = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (
      key === 'properties' &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const properties: Record<string, unknown> = {};
      for (const [propName, propValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (INTERNAL_TOOL_ARGUMENTS.has(propName)) continue;
        properties[propName] = stripInternalFields(propValue);
      }
      out[key] = properties;
      continue;
    }

    if (key === 'required' && Array.isArray(value)) {
      out[key] = value.filter(
        (name) => !INTERNAL_TOOL_ARGUMENTS.has(String(name)),
      );
      continue;
    }

    out[key] = stripInternalFields(value);
  }

  return out;
}

/**
 * Maps MCP tool definitions into the format the agent model consumes.
 *
 * The MCP schema is NOT passed through unchanged: protocol-only fields are
 * removed so the model never sees `approvalId`. The model and the executor
 * still agree on the user-facing shape of every argument.
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
        ? toModelVisibleSchema(tool.inputSchema as Record<string, unknown>)
        : { type: 'object', properties: {} },
    risk: riskFromAnnotations(tool.annotations),
  }));
}
