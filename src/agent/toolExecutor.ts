import type { AgentMcpClient } from '@mobile-agent/mcp-client';

import {
  AgentError,
  type AgentErrorCode,
  type AgentToolCall,
  type AgentToolResult,
} from './types';

const MAX_ERROR_CHARS = 600;

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
 * Executes one model-emitted tool call through MCP and normalizes every
 * outcome — success, approval_required, or failure — into a structured
 * result that can always be returned to the model. Malformed arguments,
 * unknown tools and connector failures never crash the app: they become
 * tool errors the model can reason about.
 */
export async function executeToolCall(
  mcp: AgentMcpClient,
  call: AgentToolCall,
  signal?: AbortSignal,
): Promise<AgentToolResult> {
  if (signal?.aborted) {
    throw new AgentError('CANCELLED', 'The run was stopped');
  }

  let raw: Awaited<ReturnType<AgentMcpClient['callTool']>>;
  try {
    raw = await mcp.callTool({ name: call.toolName, arguments: call.args });
  } catch (error) {
    if (signal?.aborted) {
      throw new AgentError('CANCELLED', 'The run was stopped', error);
    }
    const message =
      error instanceof Error ? error.message : 'Tool execution failed';
    const isToolError =
      error instanceof Error && error.name === 'ToolExecutionError';
    return {
      status: 'error',
      error: sanitizeForModel(message),
      errorCode: isToolError
        ? classifyToolError(message)
        : 'TOOL_EXECUTION_ERROR',
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
 * Re-invokes a gated tool with the approval id after the user confirmed.
 * The arguments are byte-identical to the approved payload (the MCP server
 * hashes them), so an approved payload executes exactly once — replays and
 * tampered payloads are rejected by the approval service.
 */
export async function executeApprovedToolCall(
  mcp: AgentMcpClient,
  call: AgentToolCall,
  approvalId: string,
  signal?: AbortSignal,
): Promise<AgentToolResult> {
  return executeToolCall(
    mcp,
    { ...call, args: { ...call.args, approvalId } },
    signal,
  );
}
