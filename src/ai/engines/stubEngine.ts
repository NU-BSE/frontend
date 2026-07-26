/**
 * Deterministic offline engine.
 *
 * Exists so every screen is exercisable before a 2GB GGUF is on the device
 * and before any backend is deployed. It streams token-by-token with
 * realistic pacing, so loading states, cancellation and autoscroll are all
 * genuinely tested rather than skipped.
 */
import type {
  EngineGenerateOptions,
  EnginePrompt,
  LlmEngine,
} from '../types';

const REPLIES = [
  'I have been watching that thread since before you opened it. The pattern repeats every fourth message.',
  'Three people typed the same sentence within a minute of each other. None of them know the others exist.',
  'That account went quiet at 03:14 and came back with a different writing style. Same device fingerprint.',
  'Nothing in this feed is addressed to you specifically. That is what makes it worth reading.',
];

function pickReply(prompts: EnginePrompt[]): string {
  const lastUser = [...prompts].reverse().find((p) => p.role === 'user');
  const seed = (lastUser?.content ?? '').length;
  return REPLIES[seed % REPLIES.length];
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createStubEngine(): LlmEngine {
  let ready = false;

  return {
    id: 'creepyim-stub',
    label: 'Offline preview',
    isReady: () => ready,
    async prepare() {
      // Simulates weight loading so the UI's "warming up" state is reachable.
      await wait(200);
      ready = true;
    },
    async *generate(
      prompts: EnginePrompt[],
      options: EngineGenerateOptions = {},
    ) {
      const words = pickReply(prompts).split(' ');
      for (let i = 0; i < words.length; i += 1) {
        if (options.signal?.aborted) return;
        await wait(38);
        yield i === 0 ? words[i] : ` ${words[i]}`;
      }
    },
    async dispose() {
      ready = false;
    },
  };
}
