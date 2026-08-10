import { ROUTING_CONFIG } from './config';
import {
  calculateReasoningScore,
  hasEmergencyExpertTrigger,
  hasHardReasoningSignal,
} from './reasoningScore';
import type { ModelTier, ReasoningSignals, RoutingDecision } from './types';

/**
 * FAST → NORMAL is much more permissive than NORMAL → EXPERT. One replan,
 * a moderate score, or large context with synthesis can trigger it — NORMAL
 * should be the common escalation tier.
 */
export function shouldEscalateFastToNormal(
  score: number,
  s: ReasoningSignals,
): boolean {
  return (
    score >= ROUTING_CONFIG.normalScoreThreshold ||
    s.replans >= 1 ||
    (s.largeUnstructuredContext && s.crossSourceSynthesis)
  );
}

/**
 * NORMAL → EXPERT uses a strict gate: the score must cross the threshold
 * AND at least one hard reasoning signal must be present. Tool count,
 * connector count, or context size alone can never do it.
 */
export function shouldEscalateNormalToExpert(
  score: number,
  s: ReasoningSignals,
): boolean {
  return (
    score >= ROUTING_CONFIG.expertScoreThreshold &&
    hasHardReasoningSignal(s)
  );
}

/**
 * The main routing entry-point. Given the current tier and observed signals,
 * returns the next tier and the reason for the decision.
 *
 * Rules (in priority order):
 * 1. EXPERT never downgrades within the same run.
 * 2. Emergency triggers (stuck planner) skip straight to EXPERT.
 * 3. NORMAL can escalate to EXPERT on hard reasoning.
 * 4. FAST can escalate to NORMAL on moderate reasoning.
 * 5. Otherwise stay.
 */
export function chooseTier(
  currentTier: ModelTier,
  signals: ReasoningSignals,
): RoutingDecision {
  const result = calculateReasoningScore(signals);

  // EXPERT is sticky — being there means the problem was hard enough to
  // warrant it, and downgrading would lose reasoning continuity.
  if (currentTier === 'expert') {
    return {
      tier: 'expert',
      reason: 'stay',
      score: result.score,
      reasons: result.reasons,
    };
  }

  // Emergency: the planner is stuck regardless of tier.
  if (hasEmergencyExpertTrigger(signals)) {
    return {
      tier: 'expert',
      reason: 'planner_stuck',
      score: result.score,
      reasons: result.reasons,
    };
  }

  // NORMAL → EXPERT (strict gate).
  if (
    currentTier === 'normal' &&
    shouldEscalateNormalToExpert(result.score, signals)
  ) {
    return {
      tier: 'expert',
      reason: 'hard_reasoning',
      score: result.score,
      reasons: result.reasons,
    };
  }

  // FAST → NORMAL (permissive gate).
  if (
    currentTier === 'fast' &&
    shouldEscalateFastToNormal(result.score, signals)
  ) {
    return {
      tier: 'normal',
      reason: 'moderate_reasoning',
      score: result.score,
      reasons: result.reasons,
    };
  }

  return {
    tier: currentTier,
    reason: 'stay',
    score: result.score,
    reasons: result.reasons,
  };
}
