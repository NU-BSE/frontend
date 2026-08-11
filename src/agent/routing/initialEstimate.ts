import type { ModelTier } from './types';

export interface InitialRoutingEstimate {
  suggestedTier: ModelTier;
  score: number;
  reasons: string[];
}

/**
 * Quick, cheap initial tier estimate from the user's message. No classifier
 * LLM — pure keyword/signal inspection. Conservative: defaults to FAST and
 * only elevates when the message is unambiguously a hard reasoning problem.
 *
 * Runtime evidence (the ReasoningComplexityMonitor) is more important — this
 * is an optional optimization to reduce latency on obviously-hard tasks.
 */
export function estimateInitialTier(userText: string): InitialRoutingEstimate {
  const lower = userText.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  // Strong constraint/optimization language
  const constraintKeywords = [
    'при условии',
    'учитывая что',
    'ограничение',
    'must be',
    'cannot be',
    'all of',
    'none of',
    'exactly one',
    'at most',
    'at least',
    'prefer',
    'priority',
    'earliest',
    'latest',
    'are free',
    'are available',
    'нельзя',
    'должен',
    'обязательно',
    'предпочтительнее',
    'раньше',
    'не раньше',
    'не позже',
    'свободны',
  ];
  for (const kw of constraintKeywords) {
    if (lower.includes(kw)) {
      score += 1;
      reasons.push(`constraint_keyword:${kw}`);
    }
  }

  // Optimization/ranking language
  const optimizationKeywords = [
    'best',
    'оптимальный',
    'самый удобный',
    'лучший',
    'choose',
    'select',
    'выбери',
    'наиболее',
    'подбери',
  ];
  for (const kw of optimizationKeywords) {
    if (lower.includes(kw)) {
      score += 1;
      reasons.push(`optimization_keyword:${kw}`);
    }
  }

  // Synthesis language
  const synthesisKeywords = [
    'compare',
    'сравни',
    'across',
    'from both',
    'из обоих',
    'reconcile',
    'согласуй',
    'determine which',
    'определи какой',
    'combine',
    'объедини',
  ];
  for (const kw of synthesisKeywords) {
    if (lower.includes(kw)) {
      score += 2;
      reasons.push(`synthesis_keyword:${kw}`);
    }
  }

  // Strong constraint + optimization + synthesis → normal.
  // EXPERT is only reachable through runtime escalation after the planner
  // has produced real reasoning metadata — never from keyword inspection alone.
  if (
    score >= 5 &&
    constraintKeywords.some((kw) => lower.includes(kw)) &&
    optimizationKeywords.some((kw) => lower.includes(kw)) &&
    synthesisKeywords.some((kw) => lower.includes(kw))
  ) {
    return { suggestedTier: 'normal', score, reasons };
  }
  
  // Multiple explicit constraints with optimization → strong signal
  if (score >= 3 && optimizationKeywords.some((kw) => lower.includes(kw))) {
    return { suggestedTier: 'normal', score, reasons };
  }

  if (score >= 3) {
    return { suggestedTier: 'normal', score, reasons };
  }

  return { suggestedTier: 'fast', score: 0, reasons };
}
