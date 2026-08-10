import type { AgentMcpClient } from '@mobile-agent/mcp-client';

import { mapMcpTools } from './toolMapper';
import { executeApprovedToolCall, executeToolCall } from './toolExecutor';
import {
  AgentError,
  MAX_AGENT_STEPS,
  type AgentMessage,
  type AgentModel,
  type AgentRunRecord,
  type AgentRunState,
  type AgentRunStep,
  type AgentToolCall,
  type AgentToolResult,
  type ConnectionSummary,
  type PendingApproval,
} from './types';

export interface AgentRuntimeOptions {
  model: AgentModel;
  mcp: AgentMcpClient;
  /** What the user actually has connected — injected into model context. */
  connections: ConnectionSummary[];
  maxSteps?: number;
  /**
   * UI-only gate: marks an approval confirmed in the approval service.
   * The model has no way to call this — approvals can only come from the
   * human through the approval sheet.
   */
  approveApproval: (approvalId: string) => Promise<void>;
  onMessages?: (messages: readonly AgentMessage[]) => void;
  onState?: (state: AgentRunState) => void;
  onRunRecord?: (record: AgentRunRecord) => void;
}

function truncateStrings(value: unknown, max = 200): unknown {
  if (typeof value === 'string') {
    return value.length > max ? `${value.slice(0, max)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => truncateStrings(item, max));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = truncateStrings(item, max);
    }
    return out;
  }
  return value;
}

/**
 * The bounded LLM ↔ MCP tool loop.
 *
 * Owns conversation messages, tool discovery, tool calls and results,
 * approval interruptions, cancellation and max-step protection. Screens
 * never talk to MCP directly — they go through this class (via
 * `useAgentChat`).
 */
export class AgentRuntime {
  private readonly maxSteps: number;
  private readonly messages: AgentMessage[] = [];
  /** Immutable snapshot handed to subscribers — a fresh reference per change. */
  private messageSnapshot: readonly AgentMessage[] = [];
  private readonly messageListeners = new Set<() => void>();

  private runState: AgentRunState = { type: 'idle' };
  private abortController: AbortController | null = null;
  private pendingApproval: PendingApproval | null = null;
  private pendingDecision: {
    resolve: (decision: 'approved' | 'denied') => void;
  } | null = null;
  private idCounter = 0;
  private runCounter = 0;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.maxSteps = options.maxSteps ?? MAX_AGENT_STEPS;
  }

  /**
   * Connections can change mid-conversation (the user connects or
   * disconnects an account). The next model step sees the fresh list.
   */
  setConnections(connections: ConnectionSummary[]): void {
    this.options.connections = connections;
  }

  getMessages(): readonly AgentMessage[] {
    return this.messageSnapshot;
  }

  /**
   * External-store subscription so React can read messages with
   * `useSyncExternalStore` — no setState inside effects.
   */
  subscribeToMessages(listener: () => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  getRunState(): AgentRunState {
    return this.runState;
  }

  getPendingApproval(): PendingApproval | null {
    return this.pendingApproval;
  }

  isRunning(): boolean {
    return this.abortController !== null;
  }

  /**
   * Runs the loop until the model produces a final answer, fails, or is
   * stopped. Resolves when the run is over regardless of outcome; errors are
   * surfaced through the run state and the persisted run record.
   */
  async sendMessage(text: string, threadId = 'general'): Promise<void> {
    if (this.abortController) {
      throw new AgentError(
        'TOOL_EXECUTION_ERROR',
        'An agent run is already in progress',
      );
    }

    const controller = new AbortController();
    this.abortController = controller;
    this.runCounter += 1;
    const runId = `run_${Date.now().toString(36)}_${this.runCounter}`;
    const steps: AgentRunStep[] = [];
    let finalAnswer: string | undefined;

    const record: AgentRunRecord = {
      id: runId,
      threadId,
      createdAt: Date.now(),
      userMessage: text,
      steps,
      engine: this.options.model.id,
    };

    try {
      this.pushMessage({
        id: this.nextId('msg'),
        role: 'user',
        content: text,
      });

      // Tool discovery happens per run, so freshly connected accounts are
      // visible immediately.
      const mcpTools = await this.options.mcp.listTools();
      const tools = mapMcpTools(mcpTools);

      let step = 0;
      while (step < this.maxSteps) {
        step += 1;
        this.throwIfAborted(controller.signal);

        this.setState({ type: 'thinking' });
        const result = await this.options.model.run({
          messages: [...this.messages],
          tools,
          connections: this.options.connections,
          signal: controller.signal,
        });

        if (result.kind === 'final') {
          finalAnswer = result.text;
          this.pushMessage({
            id: this.nextId('msg'),
            role: 'assistant',
            content: result.text,
          });
          this.setState({ type: 'responding' });
          return;
        }

        this.pushMessage({
          id: this.nextId('msg'),
          role: 'assistant',
          content: result.text ?? '',
          toolCalls: result.toolCalls,
        });

        for (const call of result.toolCalls) {
          this.throwIfAborted(controller.signal);
          this.setState({ type: 'calling_tool', toolName: call.toolName });
          steps.push({
            type: 'tool_call',
            toolName: call.toolName,
            safePreview: truncateStrings(call.args),
          });

          let toolResult = await executeToolCall(
            this.options.mcp,
            call,
            controller.signal,
          );

          if (toolResult.status === 'approval_required') {
            toolResult = await this.handleApproval(call, toolResult, steps);
          }

          steps.push({
            type: 'tool_result',
            toolName: call.toolName,
            success: toolResult.status === 'success',
          });

          this.pushMessage({
            id: this.nextId('msg'),
            role: 'tool',
            toolCallId: call.id,
            toolName: call.toolName,
            result: toolResult,
          });
        }
      }

      throw new AgentError(
        'MAX_STEPS_EXCEEDED',
        `Stopped after ${this.maxSteps} steps without a final answer. ` +
          'The task may be too complex for one request — try a smaller ask.',
      );
    } catch (error) {
      // A stop requested by the user wins over whatever error the aborted
      // model/tool work surfaced — cancellation is not a failure.
      const agentError = controller.signal.aborted
        ? new AgentError('CANCELLED', 'The run was stopped', error)
        : error instanceof AgentError
          ? error
          : new AgentError(
              'MODEL_ERROR',
              error instanceof Error ? error.message : 'The model failed',
              error,
            );

      if (agentError.code === 'CANCELLED') {
        // User-initiated stop: no scary error state, no fake answer.
        this.setState({ type: 'idle' });
      } else {
        this.pushMessage({
          id: this.nextId('msg'),
          role: 'assistant',
          content: agentError.message,
        });
        this.setState({ type: 'failed', error: agentError });
      }
    } finally {
      record.finalAnswer = finalAnswer;
      this.options.onRunRecord?.(record);
      this.abortController = null;
      this.pendingApproval = null;
      this.pendingDecision = null;
    }
  }

  /**
   * The human confirmed the exact pending payload. The approval is marked
   * approved in the approval service, then the tool is re-invoked with the
   * identical arguments plus the approval id — executing exactly once.
   */
  async approvePendingApproval(): Promise<void> {
    const decision = this.pendingDecision;
    const approval = this.pendingApproval;
    if (!decision || !approval) return;

    this.pendingDecision = null;
    this.pendingApproval = null;

    await this.options.approveApproval(approval.approvalId);
    decision.resolve('approved');
  }

  /**
   * The human declined. Nothing executes; the model receives a structured
   * `user_denied` tool result and can respond honestly.
   */
  async rejectPendingApproval(): Promise<void> {
    const decision = this.pendingDecision;
    if (!decision) return;

    this.pendingDecision = null;
    this.pendingApproval = null;
    decision.resolve('denied');
  }

  /** Stops the run, aborting pending model/tool work where supported. */
  cancel(): void {
    const decision = this.pendingDecision;
    this.abortController?.abort();
    // Unblock an approval wait so the loop can observe the abort.
    if (decision) {
      this.pendingDecision = null;
      this.pendingApproval = null;
      decision.resolve('denied');
    }
  }

  private async handleApproval(
    call: AgentToolCall,
    toolResult: AgentToolResult,
    steps: AgentRunStep[],
  ): Promise<AgentToolResult> {
    const approval: PendingApproval = {
      approvalId: toolResult.approvalId ?? '',
      toolCallId: call.id,
      toolName: call.toolName,
      connectionId:
        typeof call.args.connectionId === 'string'
          ? call.args.connectionId
          : undefined,
      args: call.args,
      preview: toolResult.approvalPreview,
    };

    steps.push({
      type: 'approval',
      toolName: call.toolName,
      safePreview: truncateStrings(call.args),
    });

    const decision = await this.waitForDecision(approval);

    if (decision === 'denied') {
      steps.push({
        type: 'approval',
        toolName: call.toolName,
        approved: false,
      });
      return {
        status: 'user_denied',
        error: 'The user declined this action. Do not retry it unchanged.',
      };
    }

    steps.push({
      type: 'approval',
      toolName: call.toolName,
      approved: true,
    });

    this.setState({ type: 'executing_tool', toolName: call.toolName });
    return executeApprovedToolCall(
      this.options.mcp,
      call,
      approval.approvalId,
      this.abortController?.signal,
    );
  }

  private waitForDecision(
    approval: PendingApproval,
  ): Promise<'approved' | 'denied'> {
    this.pendingApproval = approval;
    this.setState({ type: 'awaiting_approval', approval });
    return new Promise((resolve) => {
      this.pendingDecision = { resolve };
    });
  }

  private pushMessage(message: AgentMessage): void {
    this.messages.push(message);
    this.messageSnapshot = [...this.messages];
    for (const listener of this.messageListeners) listener();
    this.options.onMessages?.(this.messageSnapshot);
  }

  private setState(state: AgentRunState): void {
    this.runState = state;
    this.options.onState?.(state);
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new AgentError('CANCELLED', 'The run was stopped');
    }
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${this.idCounter.toString(36)}_${Date.now().toString(36)}`;
  }
}
