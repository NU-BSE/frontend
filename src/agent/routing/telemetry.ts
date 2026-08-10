import type { RoutingTelemetry, ModelTier } from './types';

/**
 * Bare-bones telemetry collector. Currently in-memory only — wire it to an
 * analytics endpoint when routing quality monitoring is desired. Contains no
 * private source content (messages, tool data); only aggregate counts and
 * tier decisions.
 */
export function createRunTelemetry(
  runId: string,
  initialTier: ModelTier,
): RoutingTelemetry {
  return {
    runId,
    initialTier,
    finalTier: initialTier,
    fastCalls: 0,
    normalCalls: 0,
    expertCalls: 0,
    expertTriggered: initialTier === 'expert',
    finalReasoningScore: 0,
    hardReasoningSignals: [],
    totalToolCalls: 0,
    totalSteps: 0,
    failedPlans: 0,
    replans: 0,
    completedSuccessfully: false,
    escalationCount: 0,
    transitions: [],
    durationMs: 0,
  };
}

export function recordModelCall(
  telemetry: RoutingTelemetry,
  tier: 'fast' | 'normal' | 'expert',
): void {
  switch (tier) {
    case 'fast':
      telemetry.fastCalls += 1;
      break;
    case 'normal':
      telemetry.normalCalls += 1;
      break;
    case 'expert':
      telemetry.expertCalls += 1;
      break;
  }
}

export function finalizeTelemetry(
  telemetry: RoutingTelemetry,
  startTime: number,
): void {
  telemetry.durationMs = Date.now() - startTime;
}
