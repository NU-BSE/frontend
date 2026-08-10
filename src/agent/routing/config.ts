export const ROUTING_CONFIG = {
  /** FAST → NORMAL when reasoning score reaches this. */
  normalScoreThreshold: 4,

  /** NORMAL → EXPERT when score ≥ this AND a hard reasoning signal is present. */
  expertScoreThreshold: 10,

  /** Same tool name + same normalized args = one repeated call. */
  loopSameCallCount: 3,

  /** Same 2-call sequence repeats = loop. */
  loopSameSequenceRepeat: 2,

  /** Consecutive failed plans that trigger emergency EXPERT. */
  maxFailedPlansBeforeExpert: 2,

  /** Consecutive replans that trigger emergency EXPERT. */
  maxReplansBeforeEmergencyExpert: 2,

  /** Invalid tool calls before emergency EXPERT. */
  maxInvalidToolCallsBeforeExpert: 3,

  /** Steps with no meaningful progress before raising a struggle signal. */
  noProgressStepThreshold: 3,

  /** Tool result size at or above which context is considered "large". */
  largeContextCharThreshold: 20_000,

  /** Tool result item count at or above which context is considered "large". */
  largeContextItemThreshold: 50,
} as const;
