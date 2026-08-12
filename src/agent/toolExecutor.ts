import type { AgentMcpClient } from '@mobile-agent/mcp-client';

import { INTERNAL_TOOL_ARGUMENTS } from './internalToolFields';
import {
  AgentError,
  type AgentErrorCode,
  type AgentToolCall,
  type AgentToolResult,
} from './types';

const MAX_ERROR_CHARS = 600;

const DEV_LOG = typeof __DEV__ === 'boolean' && __DEV__;

/**
 * Maps sanitized MCP/tool error text onto the agent error model so the UI
 * (and the model) get actionable categories instead of raw strings.
 */
export function classifyToolError(message: string): AgentErrorCode {
  if (/connection "[^"]*" was not found/iu.test(message)) {
    return 'CONNECTION_NOT_FOUND';
  }
  if (/connection "[^"]*" is (?!connected)/iu.test(message)) {
    return 'CONNECTION_EXPIRED';
  }
  if (/missing required scopes/iu.test(message)) {
    return 'PERMISSION_REQUIRED';
  }
  if (/approval/iu.test(message)) {
    return 'TOOL_VALIDATION_ERROR';
  }
  if (/rate ?limit|429/iu.test(message)) {
    return 'RATE_LIMITED';
  }
  if (/authoriz|auth required|not connected|sign[- ]?in/iu.test(message)) {
    return 'AUTH_REQUIRED';
  }
  return 'TOOL_EXECUTION_ERROR';
}

function sanitizeForModel(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= MAX_ERROR_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_ERROR_CHARS)}…`;
}

interface StructuredToolContent {
  status?: string;
  approvalId?: string;
  preview?: unknown;
  data?: unknown;
  error?: string;
}

/**
 * Removes protocol-only fields (`approvalId`, ...) from model-originated
 * arguments. The LLM is untrusted and must never be able to control the
 * approval state — even if it hallucinates a field, it is dropped here.
 */
export function sanitizeModelArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (INTERNAL_TOOL_ARGUMENTS.has(key)) {
      if (DEV_LOG) {
        console.log(`[approval] stripped model-supplied reserved argument: ${key}`);
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * The single low-level MCP invocation: sends the exact arguments given and
 * normalizes every outcome into a structured `AgentToolResult`. Never strips
 * or injects protocol fields — callers decide what the arguments are.
 */
async function callMcpTool(
  mcp: AgentMcpClient,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<AgentToolResult> {
  if (signal?.aborted) {
    throw new AgentError('CANCELLED', 'The run was stopped');
  }

  let raw: Awaited<ReturnType<AgentMcpClient['callTool']>>;
  try {
    raw = await mcp.callTool({ name, arguments: args });
  } catch (error) {
    if (signal?.aborted) {
      throw new AgentError('CANCELLED', 'The run was stopped', error);
    }
    const message =
      error instanceof Error ? error.message : 'Tool execution failed';
    const isToolError =
      error instanceof Error && error.name === 'ToolExecutionError';
    const errorCode: AgentErrorCode = isToolError
      ? classifyToolError(message)
      : 'TOOL_EXECUTION_ERROR';
    if (DEV_LOG) {
      console.error('[tool] call failed', {
        tool: name,
        errorCode,
        message,
      });
    }
    return {
      status: 'error',
      error: sanitizeForModel(message),
      errorCode,
    };
  }

  if (signal?.aborted) {
    throw new AgentError('CANCELLED', 'The run was stopped');
  }

  const structured = (raw.structuredContent ?? undefined) as
    | StructuredToolContent
    | undefined;

  if (structured?.status === 'approval_required') {
    // The approval protocol requires a non-empty approvalId; without one the
    // UI has nothing to confirm. Reject the malformed response rather than
    // opening an approval sheet for an empty id.
    if (
      typeof structured.approvalId !== 'string' ||
      structured.approvalId.length === 0
    ) {
      return {
        status: 'error',
        error: 'Tool returned an invalid approval response.',
        errorCode: 'TOOL_VALIDATION_ERROR',
      };
    }
    return {
      status: 'approval_required',
      approvalId: structured.approvalId,
      approvalPreview: structured.preview,
    };
  }

  if (structured?.status === 'outcome_unknown') {
    return {
      status: 'outcome_unknown',
      error:
        typeof structured.error === 'string'
          ? structured.error
          : 'The action may have completed, but confirmation was not received.',
      errorCode: 'OUTCOME_UNKNOWN',
    };
  }

  return {
    status: 'success',
    data: structured && 'data' in structured ? structured.data : structured,
  };
}

/**
 * Executes one model-emitted tool call through MCP. This is the untrusted
 * path: any protocol-only field the model may have emitted (`approvalId`) is
 * stripped before the MCP server ever sees the arguments.
 */
export async function executeToolCall(
  mcp: AgentMcpClient,
  call: AgentToolCall,
  signal?: AbortSignal,
): Promise<AgentToolResult> {
  return callMcpTool(mcp, call.toolName, sanitizeModelArgs(call.args), signal);
}

/**
 * Re-invokes a gated tool with the trusted approval id after the user
 * confirmed. The model's original arguments are sanitized, then the real
 * `approvalId` is injected internally — the LLM never chooses it.
 */
export async function executeApprovedToolCall(
  mcp: AgentMcpClient,
  call: AgentToolCall,
  approvalId: string,
  signal?: AbortSignal,
): Promise<AgentToolResult> {
  const args = {
    ...sanitizeModelArgs(call.args),
    approvalId,
  };
  return callMcpTool(mcp, call.toolName, args, signal);
}
