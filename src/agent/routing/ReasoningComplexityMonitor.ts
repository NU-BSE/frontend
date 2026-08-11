import { LoopDetector } from './loopDetector';
import { chooseTier } from './routingPolicy';
import { buildSignals } from './signals';
import {
  calculateReasoningScore,
} from './reasoningScore';
import { ProgressTracker } from './progressTracker';
import type {
  AgentModelResult,
  AgentToolCall,
  AgentToolResult,
} from '../types';
import type {
  AgentRunMetrics,
  LlmRoutingContext,
  ModelTier,
  ReasoningSignals,
  RoutingDecision,
  StepProgress,
} from './types';
import {
  classifyRoutingFailure,
} from './failureClassification';

function createMetrics(): AgentRunMetrics {
  return {
    stepCount: 0,
    toolCalls: 0,
    toolsUsed: [],
    connectorDomains: new Set(),
    readCalls: 0,
    writeCalls: 0,
    externalSideEffectCalls: 0,
    destructiveCalls: 0,
    failedToolCalls: 0,
    plannerFailures: 0,
    infrastructureFailures: 0,
    authFailures: 0,
    crossSourceSynthesis: false,
    conflictingEvidence: false,
    constraintSolving: false,
    temporalReconciliation: false,
    rankingOrOptimization: false,
    dependentMultiStageReasoning: false,

    unresolvedAmbiguity: false,
    modelUncertain: false,
    permissionFailures: 0,
    userDenials: 0,
    invalidToolCalls: 0,
    planRevisionCount: 0,
    failedPlanCount: 0,
    ambiguousLookupCount: 0,
    userClarificationCount: 0,
    totalToolResultChars: 0,
    totalToolResultItems: 0,
    repeatedToolPatternCount: 0,
    currentTier: 'fast',
    escalationCount: 0,
  };
}

/**
 * Observes each step of an agent run and builds up the signals the routing
 * policy consumes. The monitor is pure observation — it never makes tier
 * decisions directly; `chooseTier()` from routingPolicy owns that.
 */
export class ReasoningComplexityMonitor {
  private metrics: AgentRunMetrics = createMetrics();
  private readonly loopDetector = new LoopDetector();
  private readonly progressTracker = new ProgressTracker();
  private consecutiveFailedPlans = 0;
  private consecutiveReplans = 0;
  /** Tracks repeated failures of the same pattern. */
  private failurePatterns = new Map<string, number>();
  /** Tool names from the previous planning turn, used for progress tracking. */
  private previousStepToolNames: string[] = [];
  /** Was the previous step a planner failure? Used for replan detection. */
  private previousStepFailed = false;

  /** The current tier (updated when the runtime escalates). */
  get currentTier(): ModelTier {
    return this.metrics.currentTier;
  }

  set currentTier(tier: ModelTier) {
    this.metrics.currentTier = tier;
  }

  /** Called once per plan step (before any tool calls). */
  recordStep(): void {
    this.metrics.stepCount += 1;
  }

  /** Called after the model produces a response. */
  recordModelResponse(response: AgentModelResult): void {
    const reasoning = response.reasoning;

    if (reasoning) {
      this.metrics.crossSourceSynthesis ||= reasoning.crossSourceSynthesis === true;

      this.metrics.conflictingEvidence ||= reasoning.conflictingEvidence === true;

      this.metrics.constraintSolving ||= reasoning.constraintSolving === true;

      this.metrics.temporalReconciliation ||= reasoning.temporalReconciliation === true;

      this.metrics.rankingOrOptimization ||= reasoning.rankingOrOptimization === true;

      this.metrics.dependentMultiStageReasoning ||=
        reasoning.dependentMultiStageReasoning ===
        true;

      this.metrics.unresolvedAmbiguity ||= reasoning.unresolvedAmbiguity === true;

      if ( reasoning.needsDeeperReasoning === true 
        || ( typeof reasoning.confidence === 'number' && reasoning.confidence < 0.5 )
      ) {
        this.metrics.modelUncertain = true;
      }
    }

    if ( response.kind === 'tool_calls' ) {
      // Detect replan: a planner failure in the previous step followed by
      // a different tool choice means the model revised its approach.
      const currentToolNames = response.toolCalls.map((tc) => tc.toolName);

      if (this.previousStepFailed && this.previousStepToolNames.length > 0) {
        const previousTools = new Set(this.previousStepToolNames);
        const changedApproach = currentToolNames.some(
          (name) => !previousTools.has(name),
        );
        if (changedApproach) {
          this.recordReplan();
        }
      }

      this.previousStepToolNames = currentToolNames;
    }
  }

  /** Called after tool-result processing to track meaningful progress. */
  recordProgress(progress: StepProgress): void {
    this.progressTracker.recordProgress(progress);
  }

  /**
   * Call before a tool executes. The loop detector tracks the fingerprint
   * so repeated patterns are caught.
   */
  recordToolCall(call: AgentToolCall): void {
    this.metrics.toolCalls += 1;

    const domain = extractConnectorDomain(call.toolName);
    if (domain && !this.metrics.toolsUsed.includes(call.toolName)) {
      this.metrics.toolsUsed.push(call.toolName);
    }
    if (domain) {
      this.metrics.connectorDomains.add(domain);
    }
  }

  /** Call after a tool completes (success or failure). */
  recordToolResult(
    call: AgentToolCall,
    result: AgentToolResult,
    toolRisk?: 'read' | 'write' | 'external_side_effect' | 'destructive',
  ): void {
    this.loopDetector.record(call, result);

    if (toolRisk) {
      switch (toolRisk) {
        case 'read':
          this.metrics.readCalls += 1;
          break;
        case 'write':
          this.metrics.writeCalls += 1;
          break;
        case 'external_side_effect':
          this.metrics.externalSideEffectCalls += 1;
          break;
        case 'destructive':
          this.metrics.destructiveCalls += 1;
          break;
      }
    }
    const failureKind =
      classifyRoutingFailure(result);

    switch (failureKind) {
      case 'planner':
        this.metrics.plannerFailures += 1;
        this.consecutiveFailedPlans += 1;
        this.previousStepFailed = true;
        break;

      case 'infrastructure':
        this.metrics.infrastructureFailures += 1;
        this.consecutiveFailedPlans = 0;
        break;

      case 'auth':
        this.metrics.authFailures += 1;
        this.consecutiveFailedPlans = 0;
        break;

      case 'permission':
        this.metrics.permissionFailures += 1;
        this.consecutiveFailedPlans = 0;
        break;

      case 'user':
        this.metrics.userDenials += 1;
        this.consecutiveFailedPlans = 0;
        break;

      case 'unknown':
        this.consecutiveFailedPlans = 0;
        break;
    }

    if (result.status === 'success') {
      this.previousStepFailed = false;
    }

    if (result.status === 'error') {
      this.metrics.failedToolCalls += 1;

      const patternKey =
        `${call.toolName}::${result.errorCode ?? 'unknown'}`;
      const current = this.failurePatterns.get(patternKey) ?? 0;
      this.failurePatterns.set(patternKey, current + 1);
    }

    if (result.status === 'user_denied') {
      this.consecutiveReplans = 0;
    }

    // Invalid tool calls (e.g. wrong connection, unknown tool) → tool
    // error with a TOOL_VALIDATION_ERROR code.
    if (
      result.status === 'error' &&
      result.errorCode === 'TOOL_VALIDATION_ERROR'
    ) {
      this.metrics.invalidToolCalls += 1;
    }

    // Approximate result size for context signals.
    if (result.data !== undefined) {
      const text = JSON.stringify(result.data);
      this.metrics.totalToolResultChars += text.length;
      if (Array.isArray(result.data)) {
        this.metrics.totalToolResultItems += (result.data as unknown[]).length;
      }
    }
  }

  /** Build the signal snapshot the routing policy uses. */
  snapshot(): ReasoningSignals {
    const maxRepeatedFailurePattern = Math.max(
      0,
      ...this.failurePatterns.values(),
    );

    return buildSignals(
      this.metrics,
      this.loopDetector.isRepeating(),
      this.consecutiveFailedPlans,
      this.consecutiveReplans,
      maxRepeatedFailurePattern,
      this.progressTracker,
    );
  }

  /**
   * Decides the tier for the *next* step. The runtime calls this after each
   * tool-result batch to see whether escalation is needed.
   */
  chooseTier(): RoutingDecision {
    return chooseTier(this.metrics.currentTier, this.snapshot());
  }

  /**
   * Applies the decision returned by chooseTier. Tracks escalation count
   * for telemetry.
   */
  applyDecision(decision: RoutingDecision): void {
    const previous = this.metrics.currentTier;
    this.metrics.currentTier = decision.tier;
    if (decision.tier !== previous) {
      this.metrics.escalationCount += 1;
    }
  }

  /** Replays are tracked separately so consecutive replans trigger emergency. */
  recordReplan(): void {
    this.metrics.planRevisionCount += 1;
    this.consecutiveReplans += 1;
  }

  /** True if a replan was detected in this planning turn. */
  hadReplan(): boolean {
    return this.consecutiveReplans > 0;
  }

  /**
   * Privacy-safe context the backend can use for routing. No private message
   * bodies — only aggregate metadata.
   */
  buildRoutingContext(): LlmRoutingContext {
    const s = this.snapshot();
    return {
      requestedTier: this.metrics.currentTier,
      reasoningScore: calculateReasoningScore(s).score,
      hardReasoningSignals: collectHardReasoningSignals(s),
      weakSignals: {
        stepCount: s.stepCount,
        toolCalls: s.toolCalls,
        connectorCount: s.connectorCount,
      },
      struggle: {
        failedPlans: s.failedPlans,
        replans: s.replans,
        repeatedToolPattern: s.repeatedToolPattern,
        invalidToolCalls: s.invalidToolCalls,
        repeatedToolFailures: s.repeatedToolFailures,
      },
      context: {
        largeStructuredContext: s.largeStructuredContext,
        largeUnstructuredContext: s.largeUnstructuredContext,
      },
      escalationCount: this.metrics.escalationCount,
    };
  }

  getMetrics(): AgentRunMetrics {
    return this.metrics;
  }

  /** Reset for a new run. */
  reset(): void {
    this.metrics = createMetrics();
    this.loopDetector.reset();
    this.progressTracker.reset();
    this.consecutiveFailedPlans = 0;
    this.consecutiveReplans = 0;
    this.failurePatterns.clear();
    this.previousStepToolNames = [];
    this.previousStepFailed = false;
  }
}

function extractConnectorDomain(toolName: string): string | null {
  const dotIndex = toolName.indexOf('.');
  return dotIndex >= 0 ? toolName.slice(0, dotIndex) : null;
}

function collectHardReasoningSignals(s: ReasoningSignals): string[] {
  const list: string[] = [];
  if (s.crossSourceSynthesis) list.push('cross_source_synthesis');
  if (s.conflictingEvidence) list.push('conflicting_evidence');
  if (s.constraintSolving) list.push('constraint_solving');
  if (s.temporalReconciliation) list.push('temporal_reconciliation');
  if (s.rankingOrOptimization) list.push('ranking_or_optimization');
  if (s.dependentMultiStageReasoning) list.push('dependent_multi_stage_reasoning');
  if (s.repeatedToolPattern) list.push('repeated_tool_pattern');
  if (s.failedPlans >= 2) list.push('failed_plans');
  if (s.invalidToolCalls >= 3) list.push('invalid_tool_calls');
  return list;
}
