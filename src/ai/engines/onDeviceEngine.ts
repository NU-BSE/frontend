/**
 * On-device inference via llama.rn (llama.cpp bindings), Android-targeted.
 *
 * `llama.rn` is a native module: it does not exist in Expo Go and is absent
 * until a development build is produced. Importing it statically would crash
 * the bundle for anyone who has not run `expo prebuild` yet, so it is
 * resolved lazily and its absence is reported as a normal unavailability
 * rather than a hard failure. This is what lets `resolveEngine()` fall back.
 */
import { AsyncQueue } from '../asyncQueue';
import type {
  EngineGenerateOptions,
  EnginePrompt,
  LlmEngine,
} from '../types';

export interface OnDeviceEngineConfig {
  /** Absolute path or `file://` URI to a GGUF model on the device. */
  modelPath: string;
  /** Context window. Keep modest on mid-range Android to avoid OOM kills. */
  contextSize?: number;
  /** Layers offloaded to GPU. 0 is the safe default across Android GPUs. */
  gpuLayers?: number;
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
}

interface LlamaContext {
  completion(
    params: Record<string, unknown>,
    onToken?: (data: { token: string }) => void,
  ): Promise<{ text: string }>;
  stopCompletion(): Promise<void>;
  release(): Promise<void>;
}

type InitLlama = (options: Record<string, unknown>) => Promise<LlamaContext>;

/** Absent on Expo Go / before prebuild — never throws at module scope. */
function loadBinding(): { initLlama: InitLlama } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('llama.rn') as { initLlama?: InitLlama };
    return typeof mod?.initLlama === 'function'
      ? { initLlama: mod.initLlama }
      : null;
  } catch {
    return null;
  }
}

export function isOnDeviceSupported(): boolean {
  return loadBinding() !== null;
}

export class OnDeviceUnavailableError extends Error {
  constructor(reason: string) {
    super(`On-device inference unavailable: ${reason}`);
    this.name = 'OnDeviceUnavailableError';
  }
}

export function createOnDeviceEngine(config: OnDeviceEngineConfig): LlmEngine {
  const {
    modelPath,
    contextSize = 2048,
    gpuLayers = 0,
    maxTokens = 320,
    temperature = 0.8,
    stop = ['</s>', '<|im_end|>', '<|end|>'],
  } = config;

  let context: LlamaContext | null = null;
  let preparing: Promise<void> | null = null;

  return {
    id: 'creepyim-on-device',
    label: 'On-device model',
    isReady: () => context !== null,

    prepare() {
      // Concurrent screens may both trigger preparation; share one load.
      if (context) return Promise.resolve();
      if (preparing) return preparing;

      preparing = (async () => {
        const binding = loadBinding();
        if (!binding) {
          throw new OnDeviceUnavailableError(
            'the llama.rn native module is not present in this build',
          );
        }
        context = await binding.initLlama({
          model: modelPath,
          n_ctx: contextSize,
          n_gpu_layers: gpuLayers,
        });
      })().finally(() => {
        preparing = null;
      });

      return preparing;
    },

    async *generate(
      prompts: EnginePrompt[],
      options: EngineGenerateOptions = {},
    ) {
      if (!context) throw new OnDeviceUnavailableError('context not initialised');
      const active = context;

      const queue = new AsyncQueue<string>();

      const onAbort = () => {
        void active.stopCompletion().catch(() => undefined);
        queue.close();
      };
      options.signal?.addEventListener('abort', onAbort);

      // Fire-and-forget: tokens surface through the queue, not this promise.
      void active
        .completion(
          {
            messages: prompts.map(({ role, content }) => ({ role, content })),
            n_predict: maxTokens,
            temperature,
            stop,
          },
          (data) => {
            if (data?.token) queue.push(data.token);
          },
        )
        .then(() => queue.close())
        .catch((error) => queue.fail(error));

      try {
        yield* queue.drain();
      } finally {
        options.signal?.removeEventListener('abort', onAbort);
      }
    },

    async dispose() {
      const active = context;
      context = null;
      if (active) await active.release().catch(() => undefined);
    },
  };
}
