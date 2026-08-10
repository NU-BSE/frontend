import type { ReasoningSignals } from './types';

export interface ReasoningScore {
  score: number;
  reasons: string[];
}

/**
 * Converts observed signals into a single score and a list of human-readable
 * reasons. Weak signals (tool count, step count, connector count) add at
 * most a few points each; hard reasoning signals and struggle signals weigh
 * much heavier. The score alone is never sufficient for EXPERT — the caller
 * must also check `hasHardReasoningSignal`.
 */
export function calculateReasoningScore(
  s: ReasoningSignals,
): ReasoningScore {
  let score = 0;
  const reasons: string[] = [];

  // Weak signals
  if (s.toolCalls >= 7) {
    score += 1;
    reasons.push('many_tool_calls');
  }

  if (s.connectorCount >= 3) {
    score += 1;
    reasons.push('many_connectors');
  }

  if (s.stepCount >= 7) {
    score += 1;
    reasons.push('long_run');
  }

  if (s.largeStructuredContext) {
    score += 1;
    reasons.push('large_structured_context');
  }

  if (s.largeUnstructuredContext) {
    score += 2;
    reasons.push('large_unstructured_context');
  }

  // Hard reasoning
  if (s.crossSourceSynthesis) {
    score += 3;
    reasons.push('cross_source_synthesis');
  }

  if (s.conflictingEvidence) {
    score += 4;
    reasons.push('conflicting_evidence');
  }

  if (s.constraintSolving) {
    score += 4;
    reasons.push('constraint_solving');
  }

  if (s.temporalReconciliation) {
    score += 2;
    reasons.push('temporal_reconciliation');
  }

  if (s.rankingOrOptimization) {
    score += 3;
    reasons.push('ranking_or_optimization');
  }

  if (s.dependentMultiStageReasoning) {
    score += 3;
    reasons.push('dependent_multi_stage_reasoning');
  }

  // Agent struggle
  score += Math.min(s.failedPlans, 2) * 3;

  if (s.failedPlans > 0) {
    reasons.push('failed_plan');
  }

  score += Math.min(s.replans, 2) * 2;

  if (s.replans > 0) {
    reasons.push('replanning');
  }

  if (s.repeatedToolPattern) {
    score += 4;
    reasons.push('planner_loop');
  }

  if (s.invalidToolCalls >= 2) {
    score += 3;
    reasons.push('repeated_invalid_tool_calls');
  }

  if (s.unresolvedAmbiguity) {
    score += 1;
    reasons.push('unresolved_ambiguity');
  }

  if (s.modelUncertain) {
    score += 1;
    reasons.push('model_uncertain');
  }

  return { score, reasons };
}

/**
 * EXPERT requires a hard reasoning signal or a demonstrable struggle signal
 * — tool count or connector count alone can never elevate to expert.
 */
export function hasHardReasoningSignal(s: ReasoningSignals): boolean {
  return (
    s.conflictingEvidence ||
    s.constraintSolving ||
    s.crossSourceSynthesis ||
    s.rankingOrOptimization ||
    s.dependentMultiStageReasoning ||
    s.failedPlans >= 2 ||
    s.repeatedToolPattern ||
    s.invalidToolCalls >= 3
  );
}

/**
 * The cheap planner is visibly stuck. Even without a high score or explicit
 * hard-reasoning signal, these conditions warrant an emergency expert
 * escalation — repeating the same failing approach won't help.
 */
export function hasEmergencyExpertTrigger(
  s: ReasoningSignals,
): boolean {
  return (
    s.failedPlans >= 2 ||
    s.repeatedToolPattern ||
    s.invalidToolCalls >= 3 ||
    s.replans >= 2
  );
}
