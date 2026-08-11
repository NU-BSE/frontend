/**
 * Agent orchestration contracts.
 *
 * The LLM plans actions; MCP executes tools; connectors own provider access;
 * the UI owns human approval; credentials stay outside the model. Everything
 * in this layer follows that division.
 */

import type { LlmCapabilities } from '@/ai/types';

export type { LlmCapabilities };

export interface AgentToolDefinition {
  name: string;
  title?: string;
  description: string;
  /** JSON Schema published by the MCP server. */
  inputSchema: Record<string, unknown>;
  /** MCP tool risk level — used by the routing monitor to track action risk. */
  risk?: 'read' | 'write' | 'external_side_effect' | 'destructive';
}

export interface AgentToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

export type AgentToolResultStatus =
  | 'success'
  | 'error'
  | 'user_denied'
  | 'approval_required';

export interface AgentToolResult {
  status: AgentToolResultStatus;
  /** Structured data for successful calls. */
  data?: unknown;
  /** Sanitized, model-safe message for failures. */
  error?: string;
  errorCode?: AgentErrorCode;
  /** Present when the call needs explicit user confirmation. */
  approvalId?: string;
  approvalPreview?: unknown;
}

export type AgentMessage =
  | { id: string; role: 'user'; content: string }
  | {
      id: string;
      role: 'assistant';
      content: string;
      toolCalls?: AgentToolCall[];
    }
  | {
      id: string;
      role: 'tool';
      toolCallId: string;
      toolName: string;
      result: AgentToolResult;
    };

export interface AgentReasoningMetadata {
  crossSourceSynthesis?: boolean;
  conflictingEvidence?: boolean;
  constraintSolving?: boolean;
  temporalReconciliation?: boolean;
  rankingOrOptimization?: boolean;
  dependentMultiStageReasoning?: boolean;

  unresolvedAmbiguity?: boolean;

  /**
   * Planner self-assessment only.
   * Must never directly select a model tier.
   */
  confidence?: number;

  /**
   * Advisory signal only.
   * Router decides whether escalation is justified.
   */
  needsDeeperReasoning?: boolean;
}

export type AgentModelResult =
  | { kind: 'final'; text: string; reasoning?: AgentReasoningMetadata; }
  | { kind: 'tool_calls'; text?: string; toolCalls: AgentToolCall[]; reasoning?: AgentReasoningMetadata; };

/** Compact, secret-free description of what the user has connected. */
export interface ConnectionSummary {
  id: string;
  provider: string;
  displayName: string;
  capabilities: string[];
}

export interface AgentModelInput {
  runId: string;
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  connections: ConnectionSummary[];
  signal?: AbortSignal;
  /**
   * Adaptive routing metadata sent to the model/backend so it can select
   * the right variant. Undefined when routing is not in use (tests keep it
   * optional so existing call-sites remain unchanged).
   */
  routing?: import('./routing/types').LlmRoutingContext;
}

/**
 * The agent-facing model interface. Implementations:
 * - structured planner over a local text engine;
 * - deterministic planner for development and tests;
 * - (future) remote tool-capable model.
 *
 * A plain text completion must never be passed off as a native tool call:
 * models without `toolCalling` capability get no tools at all.
 */
export interface AgentModel {
  readonly id: string;
  readonly capabilities: LlmCapabilities;
  run(input: AgentModelInput): Promise<AgentModelResult>;
}

/**
 * A side effect waiting for the human. The exact payload (`args`) is frozen
 * here: approving executes precisely these arguments, and the MCP approval
 * hash makes any deviation fail.
 */
export interface PendingApproval {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  connectionId?: string;
  args: Record<string, unknown>;
  preview: unknown;
}

export type AgentErrorCode =
  | 'AUTH_REQUIRED'
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_EXPIRED'
  | 'PERMISSION_REQUIRED'
  | 'USER_DENIED'
  | 'TOOL_VALIDATION_ERROR'
  | 'TOOL_EXECUTION_ERROR'
  | 'MODEL_ERROR'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'CANCELLED'
  | 'MAX_STEPS_EXCEEDED';

export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export type AgentRunState =
  | { type: 'idle' }
  | { type: 'thinking' }
  | { type: 'calling_tool'; toolName: string }
  | { type: 'awaiting_approval'; approval: PendingApproval }
  | { type: 'executing_tool'; toolName: string }
  | { type: 'responding' }
  | { type: 'failed'; error: AgentError };

/** Bounded loop protection: a broken planner cannot run forever. */
export const MAX_AGENT_STEPS = 10;

/**
 * Persistable, privacy-safe record of one agent run (section 19). Safe
 * previews only — never raw secrets, never full message bodies beyond what
 * the user already saw.
 */
export interface AgentRunStep {
  type: 'tool_call' | 'tool_result' | 'approval';
  toolName: string;
  safePreview?: unknown;
  success?: boolean;
  approved?: boolean;
}

export interface AgentRunRecord {
  id: string;
  threadId: string;
  createdAt: number;
  userMessage: string;
  finalAnswer?: string;
  steps: AgentRunStep[];
  engine: string;
}
