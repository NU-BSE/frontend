import { ROUTING_CONFIG } from './config';
import type { StepProgress } from './types';

/**
 * Tracks meaningful progress across planning turns.  Raw step / tool-call
 * counts are weak signals; this detector answers the stronger question of
 * whether the run is actually moving forward or just churning.
 */
export class ProgressTracker {
  private consecutiveNoProgressSteps = 0;
  private lastProgress: StepProgress | null = null;

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

    this.lastProgress = progress;
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
    this.lastProgress = null;
  }
}

/**
 * Heuristic progress detector.  Does not model the planner — it looks at
 * the observable effects of tool calls.
 */
export function detectStepProgress(
  toolNames: string[],
  previousToolNames: string[],
  hadNewResults: boolean,
  actionFailed: boolean,
): StepProgress {
  const toolsChanged =
    toolNames.length > 0 &&
    previousToolNames.length > 0 &&
    !arraysMatch(toolNames, previousToolNames);

  return {
    newEntityResolved: hadNewResults && !actionFailed,
    newConstraintResolved: false,
    newSourceRead: hadNewResults,
    actionCompleted: hadNewResults && !actionFailed,
    planChanged: toolsChanged,
  };
}

function arraysMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}
