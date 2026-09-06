import type { MemoryProfile } from '@/storage/prefs';

export type LocalMemoryProfile = Exclude<MemoryProfile, 'cloud'>;

/**
 * A build-time override for the weights path.
 *
 * Normally empty: the model is downloaded, not shipped, so where it lives is a
 * runtime fact. `EXPO_PUBLIC_LLM_MODEL_PATH` stays for a developer who has
 * pushed a GGUF to a device by hand.
 */
export const LOCAL_MODEL_PATHS: Record<LocalMemoryProfile, string> = {
  'on-device': process.env.EXPO_PUBLIC_LLM_MODEL_PATH?.trim() || '',
};

/** What llama.rn needs to know about the model it is about to load. */
export interface ModelRuntime {
  contextSize: number;
  maxTokens: number;
}

/**
 * The smallest context worth loading with.
 *
 * The planner's system prompt is the floor, not a preference: with Android's
 * tools connected it measures about 2,200 tokens, and llama.cpp does not
 * truncate an oversized prompt — it refuses it with "Context is full" and the
 * run ends having produced nothing. Anything under this is a model that cannot
 * answer, however small and fast it is.
 */
export const MIN_CONTEXT_SIZE = 4096;

/**
 * The largest context to ask for without being told to.
 *
 * KV cache is the cost that scales with context, and on a phone already
 * holding the weights it is the thing that OOMs. 8192 is about the most that
 * has been observed to fit alongside a ~1 GB model on an 8 GB device.
 */
export const MAX_CONTEXT_SIZE = 8192;

/**
 * Runtime limits for whichever model the backend published.
 *
 * The app used to carry one pair of numbers — 4096/480 — chosen by measuring
 * the 2B GUI-Owl teacher. That is correct for exactly one model, and the
 * backend decides which model it serves: swapping it for a 0.5B or a 7B would
 * leave the app loading the new weights with the old model's budget.
 *
 * So the order of authority is:
 *
 *  1. What the bundle declares. The backend knows the model it converted, and
 *     `contextSize`/`maxTokens` on the catalogue entry are how it says so.
 *     Optional, so a server that has not been updated still works.
 *  2. Failing that, a size-derived estimate. Weight bytes are a coarse proxy
 *     for KV cache per token — both scale with layer count and hidden size —
 *     so a bigger download gets a smaller context out of the same memory. It
 *     is an estimate and reads like one; the backend saying so is always
 *     better.
 *
 * `maxTokens` is a share of the window rather than a constant: a reply that
 * cannot fit is the same failure as a prompt that cannot fit.
 */
export function runtimeForModel(bundle: {
  totalBytes?: number;
  contextSize?: number;
  maxTokens?: number;
} | null | undefined): ModelRuntime {
  const declared = bundle?.contextSize;
  const contextSize = clampContext(
    typeof declared === 'number' && declared > 0
      ? declared
      : estimateContextSize(bundle?.totalBytes),
  );

  const declaredMax = bundle?.maxTokens;
  const maxTokens =
    typeof declaredMax === 'number' && declaredMax > 0
      ? Math.min(declaredMax, Math.floor(contextSize / 2))
      : // An eighth of the window, floored so a small context still gets a
        // usable reply rather than a sentence.
        Math.max(256, Math.floor(contextSize / 8));

  return { contextSize, maxTokens };
}

function clampContext(value: number): number {
  return Math.min(MAX_CONTEXT_SIZE, Math.max(MIN_CONTEXT_SIZE, value));
}

const GIB = 1024 ** 3;

/**
 * A context size from the download size, for a backend that declares none.
 *
 * Deliberately coarse. Under a gigabyte there is room for a wider window;
 * past two, the weights themselves are most of the budget and the context has
 * to give way. Both ends are clamped, so the worst this can do is pick a
 * defensible value rather than an impossible one.
 */
function estimateContextSize(totalBytes: number | undefined): number {
  if (typeof totalBytes !== 'number' || totalBytes <= 0) {
    return MIN_CONTEXT_SIZE;
  }
  if (totalBytes < 1 * GIB) return 8192;
  if (totalBytes < 2 * GIB) return 4096;
  return MIN_CONTEXT_SIZE;
}
