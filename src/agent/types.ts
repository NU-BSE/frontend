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
  | 'approval_required'
  | 'outcome_unknown';

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

/**
 * The single normalized attachment contract used across the whole chat
 * architecture: the file picker, the composer draft, the transcript and the
 * remote transport all speak this shape.
 *
 * `uri` is a local `file://`/`content://` reference that never leaves the
 * device. `remoteId`/`remoteUrl` appear only after a successful backend
 * upload and are what the remote model actually receives. Raw binary is never
 * embedded in an `AgentMessage`.
 */
export type ChatAttachmentKind =
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'other';

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: ChatAttachmentKind;
  /** Local reference inside the app. Never sent to the backend. */
  uri?: string;
  /** Backend file id, set after a successful upload. */
  remoteId?: string;
  /** Optional backend URL, for backends that expose one. */
  remoteUrl?: string;
}

/** Transient upload lifecycle for a draft attachment (never persisted). */
export type AttachmentStatus =
  | 'ready'
  | 'uploading'
  | 'uploaded'
  | 'failed';

/** What the composer hands to the chat layer when the user sends. */
export interface ChatSendInput {
  text: string;
  attachments: ChatAttachment[];
}

export type AgentMessage =
  | { id: string; role: 'user'; content: string; attachments?: ChatAttachment[] }
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

export interface AgentModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentModelExecution {
  requestedTier: import('./routing/types').ModelTier;
  effectiveTier: import('./routing/types').ModelTier;
  routingReason: string;
  usage?: AgentModelUsage;
}

export type AgentModelResult =
  | {
      kind: 'final';
      text: string;
      reasoning?: AgentReasoningMetadata;
      execution?: AgentModelExecution;
    }
  | {
      kind: 'tool_calls';
      text?: string;
      toolCalls: AgentToolCall[];
      reasoning?: AgentReasoningMetadata;
      execution?: AgentModelExecution;
    };

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
 * - remote tool-capable model via FastAPI/OpenRouter.
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
  | 'OUTCOME_UNKNOWN'
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
  /**
   * Safe attachment metadata only — file names, never binary/base64/extracted
   * content. The full `ChatAttachment[]` (with local URIs) lives in the
   * conversation messages, not in the persisted run record.
   */
  attachmentNames?: string[];
  finalAnswer?: string;
  steps: AgentRunStep[];
  engine: string;
}
