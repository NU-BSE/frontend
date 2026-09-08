import type { AgentMcpClient } from '@mobile-agent/mcp-client';

import { mapMcpTools } from './toolMapper';
import {
  executeApprovedToolCall,
  executeToolCall,
  resolveConnectionIds,
  sanitizeModelArgs,
} from './toolExecutor';
import { alwaysActive, type ForegroundGate } from './foregroundGate';
import { ToolExecutionLedger } from './toolExecutionLedger';
import type { ToolExecutionRecord } from './toolExecutionLedger';
import { detectStepProgress } from './routing/progressTracker';
import type { StepToolResult } from './routing/progressTracker';
import {
  AgentError,
  MAX_AGENT_STEPS,
  type AgentMessage,
  type AgentModel,
  type AgentRunRecord,
  type AgentRunState,
  type AgentRunStep,
  type AgentToolCall,
  type AgentToolDefinition,
  type AgentToolResult,
  type ChatAttachment,
  type ChatSendInput,
  type ConnectionSummary,
  type PendingApproval,
} from './types';
import {
  ReasoningComplexityMonitor,
  estimateInitialTier,
  type ModelTier,
  type RoutingDecision,
} from './routing';
import {
  createRunTelemetry,
  recordModelCall,
  finalizeTelemetry,
} from './routing/telemetry';

import type {
  RoutingTelemetry,
} from './routing/types';

export interface AgentRuntimeOptions {
  model: AgentModel;
  /**
   * Local MCP client. Optional so plain remote chat still works when the
   * local MCP runtime is unavailable — tool discovery then degrades to an
   * empty list and no tool calls are emitted.
   */
  mcp?: AgentMcpClient;
  /** What the user actually has connected — injected into model context. */
  connections: ConnectionSummary[];
  /** Live grants stay executor-only; they are never sent to the model. */
  connectionScopes?: Record<string, readonly string[]>;
  /** Re-read device grants after Android returns from a consent surface. */
  refreshConnections?: () => Promise<{
    connections: ConnectionSummary[];
    connectionScopes: Record<string, readonly string[]>;
  }>;
  maxSteps?: number;
  /**
   * Whether the app is in front of the user. Defaults to always active, which
   * is right for remote runs and for Node, where there is no AppState.
   */
  foreground?: ForegroundGate;
  /**
   * UI-only gate: marks an approval confirmed in the approval service.
   * The model has no way to call this — approvals can only come from the
   * human through the approval sheet.
   */
  approveApproval: (approvalId: string) => Promise<void>;
  /** Called when the tier changes (diagnostics / status line). */
  onTierChange?: (tier: ModelTier, decision: RoutingDecision) => void;
  onRoutingTelemetry?: (telemetry: RoutingTelemetry) => void;
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
/**
 * Namespaces that exist without an account behind them.
 *
 * `system.health` is the runtime's own, and `calendar.*` is the built-in
 * calendar (`builtInCalendar` in create-server), not a connector.
 */
const ALWAYS_AVAILABLE_NAMESPACES = new Set(['system', 'calendar']);

/**
 * Offer only the tools that could actually run.
 *
 * The registry holds every connector's tools whether or not the account is
 * connected — 103 of them, about 24,000 characters once rendered into the
 * planner's prompt. That is roughly 7,000 tokens spent before the user has
 * said anything, and on a local 2B with a 3,072-token window it does not
 * merely crowd the conversation out, it makes the prompt impossible to load
 * at all: llama.cpp refuses it with "Context is full" and the run ends having
 * produced nothing.
 *
 * Filtering by connection is not a workaround for that budget. A tool for an
 * account that is not connected cannot succeed — the executor has no
 * connectionId to give it — so listing it only invites the model to try. The
 * prompt still names the connected accounts, so "Telegram is not connected"
 * remains an answer it can give.
 *
 * Matched on the tool's namespace against the connector id, tolerating the
 * suffix a connector may carry: `telegram-user` serves the `telegram.*` tools.
 */
export function toolsForConnections(
  tools: AgentToolDefinition[],
  connections: readonly ConnectionSummary[],
): AgentToolDefinition[] {
  const connected = connections.map((connection) => connection.provider);
  return tools.filter((tool) => {
    const namespace = tool.name.split('.')[0] ?? '';
    if (ALWAYS_AVAILABLE_NAMESPACES.has(namespace)) return true;
    return connected.some(
      (id) => id === namespace || id.startsWith(`${namespace}-`),
    );
  });
}

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

  /** Adaptive routing: tracks run metrics and decides tier escalation. */
  private readonly routingMonitor =
    new ReasoningComplexityMonitor();
  /** The active model tier — starts at the initial estimate, may escalate. */
  private currentTier: ModelTier = 'fast';

  /** Per-run ledger that prevents replaying completed side effects. */
  private readonly toolLedger = new ToolExecutionLedger();

  /**
   * Mutable MCP client. It arrives asynchronously (the runtime singleton
   * bootstraps after first paint) and can be torn down/rebuilt on
   * connect/disconnect, so it is updated in place rather than baked into the
   * constructor — rebuilding the runtime would drop the conversation.
   */
  private mcp: AgentMcpClient | undefined;

  private readonly foreground: ForegroundGate;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.maxSteps = options.maxSteps ?? MAX_AGENT_STEPS;
    this.mcp = options.mcp;
    this.foreground = options.foreground ?? alwaysActive;
  }

  /**
   * Holds until the app is in front of the user again.
   *
   * The state is reported so the status line reads "Paused…" rather than
   * leaving "Thinking…" on screen for a minute while nothing runs. Whatever
   * state the caller had set is restored, since the gate is a pause and not a
   * transition.
   */
  private async awaitForeground(signal: AbortSignal): Promise<void> {
    if (this.foreground.isActive()) return;

    const resumeState = this.runState;
    this.setState({ type: 'paused' });
    await this.foreground.waitUntilActive(signal);
    this.throwIfAborted(signal);
    this.setState(resumeState);
  }

  private async refreshConnectionState(): Promise<void> {
    const refreshed = await this.options.refreshConnections?.();
    if (!refreshed) return;
    this.options.connections = refreshed.connections;
    this.options.connectionScopes = refreshed.connectionScopes;
  }

  private androidConnectionFor(call: AgentToolCall): ConnectionSummary | null {
    const connectionId = call.args.connectionId;
    if (typeof connectionId !== 'string') return null;
    return (
      this.options.connections.find(
        (connection) =>
          connection.id === connectionId && connection.provider === 'android',
      ) ?? null
    );
  }

  private noAndroidConnectionResult(): AgentToolResult {
    return {
      status: 'error',
      error:
        'No Android device is connected. Connect “This device” in Creepy ' +
        'Settings, then try again.',
      errorCode: 'CONNECTION_NOT_FOUND',
    };
  }

  /** Executes and records an app-injected prerequisite just like a model call. */
  private async executePrerequisite(
    mcp: AgentMcpClient,
    call: AgentToolCall,
    tools: readonly AgentToolDefinition[],
    stepToolResults: StepToolResult[],
    steps: AgentRunStep[],
    signal: AbortSignal,
  ): Promise<AgentToolResult> {
    this.setState({ type: 'calling_tool', toolName: call.toolName });
    steps.push({
      type: 'tool_call',
      toolName: call.toolName,
      safePreview: truncateStrings(call.args),
    });

    let result = await executeToolCall(mcp, call, signal);
    if (result.status === 'approval_required') {
      result = await this.handleApproval(mcp, call, result, steps);
    }

    this.toolLedger.record(call, result);
    this.pushToolResult(
      call,
      result,
      tools.find((tool) => tool.name === call.toolName),
      stepToolResults,
      steps,
      false,
    );
    return result;
  }

  /**
   * Usage access is a prerequisite, not a failure the model must decipher.
   * Open Android's consent screen before querying, then re-read the local
   * connection and only continue when the scope was actually granted.
   */
  private async prepareAndroidUsage(
    mcp: AgentMcpClient,
    call: AgentToolCall,
    tools: readonly AgentToolDefinition[],
    stepToolResults: StepToolResult[],
    steps: AgentRunStep[],
    signal: AbortSignal,
  ): Promise<AgentToolResult | null> {
    if (call.toolName !== 'android.usage.recent') return null;

    const connection = this.androidConnectionFor(call);
    if (!connection) return this.noAndroidConnectionResult();

    const scopes = this.options.connectionScopes?.[connection.id];
    // Runtimes without a scope source (notably isolated tests) retain the
    // ordinary MCP behavior rather than assuming a permission is missing.
    if (!scopes || scopes.includes('android.usage.read')) return null;

    const openCall: AgentToolCall = {
      id: this.nextId('call'),
      toolName: 'android.settings.open',
      args: { connectionId: connection.id, screen: 'usageAccess' },
    };
    const opened = await this.executePrerequisite(
      mcp,
      openCall,
      tools,
      stepToolResults,
      steps,
      signal,
    );
    if (opened.status !== 'success') {
      return opened.status === 'user_denied'
        ? opened
        : {
            status: 'error',
            error:
              'Creepy could not open Android Usage access settings. Open ' +
              'Creepy’s device settings and allow Usage access, then try again.',
            errorCode: 'PERMISSION_REQUIRED',
          };
    }

    // Give AppState a chance to observe the system activity before waiting
    // for the return. The Settings tool itself completes as soon as it opens.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await this.awaitForeground(signal);
    await this.refreshConnectionState();

    const refreshedScopes = this.options.connectionScopes?.[connection.id];
    if (!refreshedScopes?.includes('android.usage.read')) {
      return {
        status: 'error',
        error:
          'Usage access is still off. Turn on Usage access for Creepy in ' +
          'Android Settings, return to Creepy, and try again.',
        errorCode: 'PERMISSION_REQUIRED',
      };
    }

    return null;
  }

  private assistantRoleRequired(
    call: AgentToolCall,
    result: AgentToolResult,
  ): boolean {
    return (
      call.toolName.startsWith('android.assistant.') &&
      call.toolName !== 'android.assistant.request_role' &&
      result.status === 'error' &&
      result.errorCode === 'PERMISSION_REQUIRED'
    );
  }

  /** Requests the assistant role, refreshes consent, and retries the operation. */
  private async recoverAssistantRole(
    mcp: AgentMcpClient,
    originalCall: AgentToolCall,
    tools: readonly AgentToolDefinition[],
    stepToolResults: StepToolResult[],
    steps: AgentRunStep[],
    signal: AbortSignal,
  ): Promise<AgentToolResult> {
    const connection = this.androidConnectionFor(originalCall);
    if (!connection) return this.noAndroidConnectionResult();

    const requestCall: AgentToolCall = {
      id: this.nextId('call'),
      toolName: 'android.assistant.request_role',
      args: { connectionId: connection.id },
    };
    const requested = await this.executePrerequisite(
      mcp,
      requestCall,
      tools,
      stepToolResults,
      steps,
      signal,
    );
    if (requested.status !== 'success') return requested;

    await this.awaitForeground(signal);
    await this.refreshConnectionState();

    const statusCall: AgentToolCall = {
      id: this.nextId('call'),
      toolName: 'android.assistant.get_status',
      args: { connectionId: connection.id },
    };
    const status = await this.executePrerequisite(
      mcp,
      statusCall,
      tools,
      stepToolResults,
      steps,
      signal,
    );
    const role = status.data as { isDefault?: unknown } | undefined;
    if (status.status !== 'success' || role?.isDefault !== true) {
      return {
        status: 'error',
        error:
          'Creepy is not the active Android assistant. Choose Creepy in the ' +
          'Android assistant-role prompt, then return and try again.',
        errorCode: 'PERMISSION_REQUIRED',
      };
    }

    this.setState({ type: 'calling_tool', toolName: originalCall.toolName });
    let retried = await executeToolCall(mcp, originalCall, signal);
    if (retried.status === 'approval_required') {
      retried = await this.handleApproval(mcp, originalCall, retried, steps);
    }
    return retried;
  }

  /** Updates the local MCP client without rebuilding the runtime. */
  setMcp(mcp: AgentMcpClient | undefined): void {
    this.mcp = mcp;
  }

  /** Returns the current tier (diagnostics / status line). */
  getCurrentTier(): ModelTier {
    return this.currentTier;
  }

  /**
   * Connections can change mid-conversation (the user connects or
   * disconnects an account). The next model step sees the fresh list.
   */
  setConnections(connections: ConnectionSummary[]): void {
    this.options.connections = connections;
  }

  setConnectionScopes(scopes: Record<string, readonly string[]>): void {
    this.options.connectionScopes = scopes;
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
   *
   * Accepts a plain string for backward compatibility (tests and text-only
   * call sites) or a `ChatSendInput` carrying attachments.
   */
  async sendMessage(
    input: string | ChatSendInput,
    threadId = 'general',
  ): Promise<void> {
    const sendInput: ChatSendInput =
      typeof input === 'string' ? { text: input, attachments: [] } : input;
    const text = sendInput.text;
    const attachments = sendInput.attachments;
    const hasAttachments = attachments.length > 0;

    if (this.abortController) {
      throw new AgentError(
        'TOOL_EXECUTION_ERROR',
        'An agent run is already in progress',
      );
    }

    // A model that cannot consume files must never be called with only the
    // text while the attachments silently vanish. Keep the user message (with
    // its attachments) visible and fail loudly instead.
    if (hasAttachments && this.options.model.capabilities.fileInput !== true) {
      const message =
        'This model cannot open attachments. Connect a remote (cloud) model ' +
        'to analyze files — on-device text models only read text.';
      this.pushMessage({
        id: this.nextId('msg'),
        role: 'user',
        content: text,
        attachments,
      });
      this.pushMessage({
        id: this.nextId('msg'),
        role: 'assistant',
        content: message,
      });
      this.setState({
        type: 'failed',
        error: new AgentError('MODEL_ERROR', message),
      });
      return;
    }

    const controller = new AbortController();
    this.abortController = controller;
    this.runCounter += 1;
    const runId = `run_${Date.now().toString(36)}_${this.runCounter}`;
    const routingStartedAt = Date.now();

    const steps: AgentRunStep[] = [];
    let finalAnswer: string | undefined;

    const record: AgentRunRecord = {
      id: runId,
      threadId,
      createdAt: Date.now(),
      userMessage: text.trim() || buildAttachmentSummary(attachments),
      ...(hasAttachments
        ? { attachmentNames: attachments.map((a) => a.name) }
        : {}),
      steps,
      engine: this.options.model.id,
    };

    // Adaptive routing: boot based on the user's request and reset the
    // monitor from any previous run.
    this.routingMonitor.reset();
    this.toolLedger.reset();

    const initialEstimate = estimateInitialTier(
      text.trim() || buildAttachmentSummary(attachments),
    );

    this.currentTier = initialEstimate.suggestedTier;

    this.routingMonitor.currentTier = this.currentTier;

    const routingTelemetry =
      createRunTelemetry(
        runId,
        this.currentTier,
      );

    try {
      this.pushMessage({
        id: this.nextId('msg'),
        role: 'user',
        content: text,
        ...(hasAttachments ? { attachments } : {}),
      });

      // Tool discovery happens per run, so freshly connected accounts are
      // visible immediately. Local MCP is optional: a temporary MCP failure
      // must not block plain remote chat — it degrades to an empty tool list.
      let tools: AgentToolDefinition[] = [];
      if (this.mcp) {
        try {
          const mcpTools = await this.mcp.listTools();
          tools = toolsForConnections(
            mapMcpTools(mcpTools),
            this.options.connections,
          );
        } catch (error) {
          if (typeof __DEV__ === 'boolean' && __DEV__) {
            console.log(
              '[chat] MCP tool discovery failed; continuing with 0 tools',
              error,
            );
          }
          tools = [];
        }
      }

      let step = 0;
      let previousStepResults: StepToolResult[] = [];
      while (step < this.maxSteps) {
        step += 1;
        this.throwIfAborted(controller.signal);

        /*
         * Do not plan behind the user's back. A step taken while they are on a
         * system screen reads a device state they are in the middle of
         * changing, and queues approval sheets they cannot see.
         */
        await this.awaitForeground(controller.signal);

        this.routingMonitor.recordStep();

        this.setState({ type: 'thinking' });

        const requestedTier = this.currentTier;

        const result =
          await this.options.model.run({
            runId,
            messages: [...this.messages],
            tools,
            connections:
              this.options.connections,
            signal: controller.signal,
            routing:
              this.routingMonitor
                .buildRoutingContext(),
          });

        const effectiveTier =
          result.execution
            ?.effectiveTier ??
          requestedTier;

        recordModelCall(
          routingTelemetry,
          effectiveTier,
        );

        const execution =
          result.execution;

        if (execution) {
          if (execution.usage) {
            routingTelemetry.promptTokens +=
              execution.usage.promptTokens;
            routingTelemetry.completionTokens +=
              execution.usage.completionTokens;
            routingTelemetry.totalTokens +=
              execution.usage.totalTokens;
          }

          if (
            tierRank(
              execution.effectiveTier,
            ) <
            tierRank(
              execution.requestedTier,
            )
          ) {
            routingTelemetry
              .backendDowngradeCount += 1;
          }

          if (
            execution.routingReason ===
            'provider_fallback'
          ) {
            routingTelemetry
              .providerFallbackCount += 1;
          }
        }

        const replanBefore = this.routingMonitor.hadReplan();

        this.routingMonitor.recordModelResponse(result);

        const wasReplan =
          !replanBefore &&
          this.routingMonitor.hadReplan();

        if (result.kind === 'final') {
          routingTelemetry.completedSuccessfully = true;
          finalAnswer = result.text;
          this.pushMessage({
            id: this.nextId('msg'),
            role: 'assistant',
            content: result.text,
          });
          this.setState({ type: 'responding' });
          return;
        }

        /*
         * Before anything else sees them, so the approval sheet, the
         * transcript the model reads back, and the call that runs all agree.
         */
        const toolCalls = resolveConnectionIds(
          result.toolCalls,
          this.options.connections,
        );

        this.pushMessage({
          id: this.nextId('msg'),
          role: 'assistant',
          content: result.text ?? '',
          toolCalls,
        });

        const stepToolResults: StepToolResult[] = [];

        for (const call of toolCalls) {
          this.throwIfAborted(controller.signal);
          // One step can carry several calls, and the first is often the one
          // that sent the user out of the app.
          await this.awaitForeground(controller.signal);
          this.setState({ type: 'calling_tool', toolName: call.toolName });
          steps.push({
            type: 'tool_call',
            toolName: call.toolName,
            safePreview: truncateStrings(call.args),
          });

          this.routingMonitor.recordToolCall(call);

          const toolDef = tools.find((tool) => tool.name === call.toolName);
          const isSideEffect =
            toolDef?.risk === 'write' ||
            toolDef?.risk === 'external_side_effect' ||
            toolDef?.risk === 'destructive';

          /*
           * A call that already failed this run is not run again.
           *
           * Unlike the guards below, this applies to every tool, not only the
           * side-effecting ones: a read that failed on its arguments fails the
           * same way on the same arguments, and four identical
           * `android.settings.open_app` failures are what spent a whole run's
           * budget and ended it at the step ceiling.
           *
           * The model gets the original error back, plus the one instruction
           * it needs — change something or say it cannot. Different arguments
           * hash differently and are never blocked.
           */
          const settledFailure = this.toolLedger.findRepeatedFailure(call);
          if (settledFailure) {
            const previous = settledFailure.result?.error ?? 'It failed.';
            this.pushToolResult(
              call,
              {
                status: 'error',
                error:
                  `${previous} You already called ${call.toolName} with these ` +
                  'exact arguments and it failed for this reason. Repeating it ' +
                  'will not help: change the arguments, use a different tool, ' +
                  'or reply with {"type":"final"} telling the user what you ' +
                  'could not do.',
                errorCode: settledFailure.result?.errorCode ?? 'TOOL_EXECUTION_ERROR',
              },
              toolDef,
              stepToolResults,
              steps,
              false,
            );
            continue;
          }

          // Idempotency guard: never replay a completed side effect.
          if (isSideEffect) {
            const duplicate =
              this.toolLedger.findDuplicate(call);

            if (duplicate) {
              const dedupResult =
                buildDeduplicatedResult(duplicate);

              this.pushToolResult(
                call,
                dedupResult,
                toolDef,
                stepToolResults,
                steps,
                true,
              );

              continue;
            }

            // An uncertain side effect (timeout after submission) must not be
            // auto-replayed — the physical effect may already have happened.
            const uncertain =
              this.toolLedger.findUncertain(call);

            if (uncertain) {
              const uncertainResult: AgentToolResult = {
                status: 'outcome_unknown',
                error:
                  'The previous action may have completed, but confirmation ' +
                  'was not received. Ask the user whether it went through ' +
                  'before repeating it.',
                errorCode: 'OUTCOME_UNKNOWN',
              };

              this.pushToolResult(
                call,
                uncertainResult,
                toolDef,
                stepToolResults,
                steps,
                false,
              );

              continue;
            }
          }

          let toolResult: AgentToolResult;
          if (!this.mcp) {
            // No local MCP runtime, yet the model asked for a tool. This only
            // happens with a stale/misconfigured tool list — fail honestly.
            toolResult = {
              status: 'error',
              error:
                'The local tool runtime is unavailable, so this action cannot be executed.',
              errorCode: 'TOOL_EXECUTION_ERROR',
            };
          } else if (
            call.toolName.startsWith('android.') &&
            !this.androidConnectionFor(call)
          ) {
            toolResult = this.noAndroidConnectionResult();
          } else {
            const prerequisiteResult = await this.prepareAndroidUsage(
              this.mcp,
              call,
              tools,
              stepToolResults,
              steps,
              controller.signal,
            );
            toolResult =
              prerequisiteResult ??
              (await executeToolCall(this.mcp, call, controller.signal));
          }

          if (toolResult.status === 'approval_required' && this.mcp) {
            toolResult = await this.handleApproval(
              this.mcp,
              call,
              toolResult,
              steps,
            );
          }

          if (
            this.mcp &&
            this.assistantRoleRequired(call, toolResult)
          ) {
            toolResult = await this.recoverAssistantRole(
              this.mcp,
              call,
              tools,
              stepToolResults,
              steps,
              controller.signal,
            );
          }

          this.toolLedger.record(call, toolResult);

          this.pushToolResult(
            call,
            toolResult,
            toolDef,
            stepToolResults,
            steps,
            false,
          );
        }

        // Progress tracking: detect whether this step moved the run forward.
        const stepProgress = detectStepProgress(
          stepToolResults,
          previousStepResults,
          wasReplan,
        );
        this.routingMonitor.recordProgress(stepProgress);
        previousStepResults = stepToolResults;

        // Check whether the current tier needs escalation after this tool batch.
        const routingDecision = this.routingMonitor.chooseTier();
        if (routingDecision.tier !== this.currentTier) {
          const previousTier = this.currentTier;

          this.currentTier = routingDecision.tier;
          this.routingMonitor.applyDecision(routingDecision);

          routingTelemetry.transitions.push({
            from: previousTier,
            to: this.currentTier,
            reason: routingDecision.reason,
            score: routingDecision.score,
            step,
          });

          if (this.currentTier === 'expert') {
            routingTelemetry.expertTriggered = true;
            routingTelemetry.expertTriggerReason = routingDecision.reason;
          }

          this.options.onTierChange?.(this.currentTier, routingDecision);
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
      const metrics = this.routingMonitor.getMetrics();
      const signals = this.routingMonitor.snapshot();
      const routingContext = this.routingMonitor.buildRoutingContext();
      routingTelemetry.finalTier = this.currentTier;
      routingTelemetry.finalReasoningScore = routingContext.reasoningScore;
      routingTelemetry.hardReasoningSignals = routingContext.hardReasoningSignals;
      routingTelemetry.totalToolCalls = metrics.toolCalls;
      routingTelemetry.totalSteps = metrics.stepCount;
      routingTelemetry.failedPlans = signals.failedPlans;
      routingTelemetry.replans = signals.replans;
      routingTelemetry.escalationCount = metrics.escalationCount;
      finalizeTelemetry(routingTelemetry, routingStartedAt);
      this.options.onRoutingTelemetry?.(routingTelemetry);
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

    try {
      await this.options.approveApproval(approval.approvalId);
      this.pendingDecision = null;
      this.pendingApproval = null;
      decision.resolve('approved');
    } catch {
      // Restore so the user can retry or cancel — the pending approval
      // must not silently disappear on an approval-service failure.
      this.pendingDecision = decision;
      this.pendingApproval = approval;
      throw new AgentError(
        'TOOL_EXECUTION_ERROR',
        'Failed to mark the approval as confirmed. You can try again or cancel.',
      );
    }
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
    mcp: AgentMcpClient,
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
      // Freeze the sanitized payload — no protocol field the model may have
      // emitted ever appears in the sheet or the approved execution.
      args: sanitizeModelArgs(call.args),
      preview: toolResult.approvalPreview,
    };

    if (typeof __DEV__ === 'boolean' && __DEV__) {
      console.log(
        `[approval] awaiting user confirmation id=${approval.approvalId} tool=${call.toolName}`,
      );
    }

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

    if (typeof __DEV__ === 'boolean' && __DEV__) {
      console.log(
        `[approval] approved id=${approval.approvalId} tool=${call.toolName}`,
      );
    }

    steps.push({
      type: 'approval',
      toolName: call.toolName,
      approved: true,
    });

    this.setState({ type: 'executing_tool', toolName: call.toolName });
    return executeApprovedToolCall(
      mcp,
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

  /** Records a tool result into progress tracking, run record, and messages. */
  private pushToolResult(
    call: AgentToolCall,
    toolResult: AgentToolResult,
    toolDef: AgentToolDefinition | undefined,
    stepToolResults: StepToolResult[],
    steps: AgentRunStep[],
    deduplicated: boolean,
  ): void {
    stepToolResults.push({
      call,
      result: toolResult,
      ...(deduplicated ? { deduplicated: true } : {}),
    });

    this.routingMonitor.recordToolResult(
      call,
      toolResult,
      toolDef?.risk,
    );

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

function tierRank(tier: ModelTier): number {
  switch (tier) {
    case 'fast':
      return 0;
    case 'normal':
      return 1;
    case 'expert':
      return 2;
  }
}

/**
 * Routing-only summary of a file-only message. This string feeds the tier
 * estimator and the run record when the user attached files without text; it
 * never replaces the real attachments carried on the message itself.
 */
function buildAttachmentSummary(attachments: ChatAttachment[]): string {
  if (attachments.length === 0) return '';
  const names = attachments.map((a) => a.name).join(', ');
  return attachments.length === 1
    ? `User attached 1 file: ${names}`
    : `User attached ${attachments.length} files: ${names}`;
}

/**
 * Rebuilds the result for a deduplicated side effect. The original output is
 * preserved (event id, message id, …) so a dependent next step can consume it,
 * with `deduplicated`/`originalCallId` appended rather than replacing it.
 */
function buildDeduplicatedResult(
  duplicate: ToolExecutionRecord,
): AgentToolResult {
  const original = duplicate.result;
  const meta = { deduplicated: true, originalCallId: duplicate.toolCallId };

  if (
    original &&
    typeof original.data === 'object' &&
    original.data !== null &&
    !Array.isArray(original.data)
  ) {
    return {
      ...original,
      data: { ...(original.data as Record<string, unknown>), ...meta },
    };
  }

  return { status: 'success', data: meta };
}
