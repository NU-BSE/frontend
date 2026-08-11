/**
 * Model tiers for adaptive routing.
 *
 * Do not name tiers after providers or model IDs in frontend code — the
 * backend maps `expert` to Terra or any future replacement. The mobile app
 * never hard-codes a concrete provider name.
 */
export type ModelTier = 'fast' | 'normal' | 'expert';

/**
 * A fingerprint with which identical tool calls can be identified. Names
 * and normalised argument hashes are compared — exact identity and order
 * of arguments don't matter.
 */
export interface ToolCallFingerprint {
  toolName: string;
  normalizedArgsHash: string;
}

/**
 * Observations collected during an agent run. These are the raw data the
 * reasoning scorer and loop detector consume — they are not themselves
 * the final routing decision.
 */
export interface AgentRunMetrics {
  stepCount: number;
  toolCalls: number;
  toolsUsed: string[];
  connectorDomains: Set<string>;
  readCalls: number;
  writeCalls: number;
  externalSideEffectCalls: number;
  destructiveCalls: number;
  failedToolCalls: number;
  plannerFailures: number;
  infrastructureFailures: number;
  authFailures: number;
  permissionFailures: number;
  userDenials: number;
  crossSourceSynthesis: boolean;
  conflictingEvidence: boolean;
  constraintSolving: boolean;
  temporalReconciliation: boolean;
  rankingOrOptimization: boolean;
  dependentMultiStageReasoning: boolean;
  unresolvedAmbiguity: boolean;
  modelUncertain: boolean;
  invalidToolCalls: number;
  planRevisionCount: number;
  failedPlanCount: number;
  ambiguousLookupCount: number;
  userClarificationCount: number;
  totalToolResultChars: number;
  totalToolResultItems: number;
  repeatedToolPatternCount: number;
  currentTier: ModelTier;
  escalationCount: number;
}

export interface TierTransition {
  from: ModelTier;
  to: ModelTier;

  reason: string;
  score: number;

  step: number;
}

/**
 * Signals the reasoning scorer actually inspects. Execution-only metrics
 * (weak signals) are separated from reasoning-hard ones on purpose: an
 * EXPERT escalation always requires a hard signal unless the planner is
 * demonstrably stuck.
 */
export interface ReasoningSignals {
  // Weak execution signals
  toolCalls: number;
  connectorCount: number;
  stepCount: number;

  // Context signals
  largeUnstructuredContext: boolean;
  largeStructuredContext: boolean;

  // Hard reasoning signals (currently require planner metadata — all false
  // until the structured planner emits these flags per section 18).
  crossSourceSynthesis: boolean;
  conflictingEvidence: boolean;
  constraintSolving: boolean;
  temporalReconciliation: boolean;
  rankingOrOptimization: boolean;
  dependentMultiStageReasoning: boolean;

  // Agent struggle signals (directly observable)
  failedPlans: number;
  replans: number;
  repeatedToolPattern: boolean;
  invalidToolCalls: number;
  repeatedToolFailures: number;

  // Uncertainty signals
  unresolvedAmbiguity: boolean;
  modelUncertain: boolean;
}

/** One step in the tier decision. */
export type EscalationReason =
  | 'stay'
  | 'moderate_reasoning'
  | 'hard_reasoning'
  | 'planner_stuck'
  | 'emergency';

export interface RoutingDecision {
  tier: ModelTier;
  reason: EscalationReason;
  score: number;
  reasons: string[];
}

/** Privacy-safe routing context sent to the backend. */
export interface LlmRoutingContext {
  requestedTier: ModelTier;
  reasoningScore: number;
  hardReasoningSignals: string[];
  weakSignals: {
    stepCount: number;
    toolCalls: number;
    connectorCount: number;
  };
  struggle: {
    failedPlans: number;
    replans: number;
    repeatedToolPattern: boolean;
    invalidToolCalls: number;
    repeatedToolFailures: number;
  };
  context: {
    largeStructuredContext: boolean;
    largeUnstructuredContext: boolean;
  };
  escalationCount: number;
}

/** Telemetry written after a run completes. */
export interface RoutingTelemetry {
  runId: string;
  initialTier: ModelTier;
  finalTier: ModelTier;
  fastCalls: number;
  normalCalls: number;
  expertCalls: number;
  expertTriggered: boolean;
  expertTriggerReason?: string;
  finalReasoningScore: number;
  hardReasoningSignals: string[];
  totalToolCalls: number;
  totalSteps: number;
  failedPlans: number;
  replans: number;
  completedSuccessfully: boolean;
  durationMs: number;
  escalationCount: number;
  transitions: TierTransition[];
  backendDowngradeCount: number;
  providerFallbackCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Lightweight plan identity for detecting replanning. */
export interface PlanSnapshot {
  objective: string;
  nextActions: string[];
  assumptions: string[];
}

/**
 * Whether a step produced genuinely new state rather than just churning.
 * Not all steps are progress — tracking this is stronger than raw step count.
 */
export interface StepProgress {
  newEntityResolved: boolean;
  newConstraintResolved: boolean;
  newSourceRead: boolean;
  actionCompleted: boolean;
  planChanged: boolean;
}

export interface RoutingEvaluation {
  id: string;
  description: string;
  expectedMaxTier: ModelTier;
  input: {
    currentTier: ModelTier;
    signals: Partial<ReasoningSignals>;
  };
}
