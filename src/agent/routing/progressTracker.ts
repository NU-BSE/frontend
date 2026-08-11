import { ROUTING_CONFIG } from './config';
import type { StepProgress } from './types';
import type { AgentToolCall, AgentToolResult } from '../types';

/** A single tool invocation result collected during one planning step. */
export interface StepToolResult {
  call: AgentToolCall;
  result: AgentToolResult;
  /** True when the execution was blocked by the idempotency ledger. */
  deduplicated?: boolean;
}

/**
 * Tracks meaningful progress across planning turns.  Raw step / tool-call
 * counts are weak signals; this detector answers the stronger question of
 * whether the run is actually moving forward or just churning.
 */
export class ProgressTracker {
  private consecutiveNoProgressSteps = 0;

  /** Call after each batch of tool results. */
  recordProgress(progress: StepProgress): void {
    const madeProgress =
      progress.newEntityResolved ||
      progress.newConstraintResolved ||
      progress.newSourceRead ||
      progress.actionCompleted;

    if (madeProgress || progress.planChanged) {
      this.consecutiveNoProgressSteps = 0;
    } else {
      this.consecutiveNoProgressSteps += 1;
    }
  }

  /**
   * Returns true when the same non-productive step pattern is repeating
   * without any meaningful change in state.
   */
  isStuck(): boolean {
    return (
      this.consecutiveNoProgressSteps >=
      ROUTING_CONFIG.noProgressStepThreshold
    );
  }

  /** Number of consecutive steps with no meaningful progress. */
  getStuckStepCount(): number {
    return this.consecutiveNoProgressSteps;
  }

  reset(): void {
    this.consecutiveNoProgressSteps = 0;
  }
}

/**
 * Determines whether a planning step made meaningful progress.
 *
 * Inspects actual tool results — not the idempotency ledger.
 *
 * Progress exists when at least one tool call:
 *   - successfully returned new data (new entity resolved, new source read);
 *   - successfully completed a side-effect (actionCompleted);
 *   - resolved a previous constraint/ambiguity.
 *
 * No progress:
 *   - deduplicated side-effects (ledger blocked execution);
 *   - network / auth / permission / user-denied failures;
 *   - tool validation errors (planner-level failures);
 *   - repeating the same tool with identical args and identical outcome.
 */
export function detectStepProgress(
  results: StepToolResult[],
  previousSuccessResults: StepToolResult[],
  wasReplan: boolean,
): StepProgress {
  let newEntityResolved = false;
  let newSourceRead = false;
  let actionCompleted = false;

  for (const { call, result, deduplicated } of results) {
    if (deduplicated) {
      // Already-executed action — not new progress.
      continue;
    }

    if (result.status === 'success') {
      // Successful read with data = new entity or new source.
      if (result.data !== undefined) {
        newEntityResolved = true;
        newSourceRead = true;
      }

      // Is this a successful outcome that was NOT seen before?
      const prevMatch = previousSuccessResults.find(
        (prev) =>
          prev.call.toolName === call.toolName &&
          JSON.stringify(prev.call.args) === JSON.stringify(call.args),
      );

      if (!prevMatch) {
        actionCompleted = true;
      }
    }

    // Failures are never treated as progress.
  }

  return {
    newEntityResolved,
    newConstraintResolved: false,
    newSourceRead,
    actionCompleted,
    planChanged: wasReplan,
  };
}
