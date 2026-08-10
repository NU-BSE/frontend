import { ROUTING_CONFIG } from './config';
import type { AgentRunMetrics, ReasoningSignals } from './types';

/**
 * Converts raw run metrics into the structured signal set the reasoning
 * scorer inspects. Hard reasoning signals (crossSourceSynthesis,
 * conflictingEvidence, etc.) are false until the structured planner emits
 * them as optional metadata — they are not derivable from tool counts alone.
 */
export function buildSignals(
  metrics: AgentRunMetrics,
  isRepeating: boolean,
  consecutiveFailedPlans: number,
  consecutiveReplans: number,
): ReasoningSignals {
  return {
    toolCalls: metrics.toolCalls,
    connectorCount: metrics.connectorDomains.size,
    stepCount: metrics.stepCount,

    largeUnstructuredContext:
      metrics.totalToolResultChars >= ROUTING_CONFIG.largeContextCharThreshold,
    largeStructuredContext:
      metrics.totalToolResultItems >= ROUTING_CONFIG.largeContextItemThreshold,

    // Hard reasoning signals — false until planner metadata is available.
    crossSourceSynthesis: metrics.crossSourceSynthesis,
    conflictingEvidence: metrics.conflictingEvidence,
    constraintSolving: metrics.constraintSolving,
    temporalReconciliation: metrics.temporalReconciliation,
    rankingOrOptimization: metrics.rankingOrOptimization,
    dependentMultiStageReasoning: metrics.dependentMultiStageReasoning,
    unresolvedAmbiguity: metrics.unresolvedAmbiguity,
    modelUncertain: metrics.modelUncertain,

    failedPlans: consecutiveFailedPlans,
    replans: consecutiveReplans,
    repeatedToolPattern: isRepeating,
    invalidToolCalls: metrics.invalidToolCalls,
    repeatedToolFailures: metrics.failedToolCalls,
  };
}
