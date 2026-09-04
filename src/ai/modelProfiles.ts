import type { MemoryProfile } from '@/storage/prefs';

export type LocalMemoryProfile = Exclude<MemoryProfile, 'cloud'>;

/**
 * Where the on-device weights live.
 *
 * One entry, because there is one local model: the 2B GUI-Owl teacher. The
 * three size tiers this replaced each pointed at a different student
 * (0.5B/1B/1.5B), and those are retired.
 */
export const LOCAL_MODEL_PATHS: Record<LocalMemoryProfile, string> = {
  'on-device': process.env.EXPO_PUBLIC_LLM_MODEL_PATH?.trim() || '',
};

/**
 * Runtime limits for the local model.
 *
 * Sized for the 2B teacher rather than inherited from the old top tier: a
 * larger model needs proportionally more KV cache per token of context, and
 * the context that fit a 1.5B student in the same RAM does not fit this one.
 */
export const LOCAL_MODEL_RUNTIME: Record<
  LocalMemoryProfile,
  { contextSize: number; maxTokens: number }
> = {
  /*
   * 4096, sized against a measured prompt rather than guessed.
   *
   * The planner's system prompt is dominated by the tool list. Unfiltered that
   * is 103 tools and roughly 7,000 tokens, which no plausible window on a
   * phone accommodates; `toolsForConnections` cuts it to the connected
   * accounts, which for three connectors measures around 2,000 tokens. 4096
   * leaves the conversation about half the window.
   *
   * Raising it further is not free: the KV cache is roughly 56 KB per token
   * for this model, so every 1,000 tokens of context costs about 56 MB of
   * native memory on a device that also has to hold 1.1 GB of weights.
   */
  'on-device': { contextSize: 4096, maxTokens: 480 },
};
