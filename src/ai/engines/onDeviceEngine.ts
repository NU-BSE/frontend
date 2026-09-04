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
  /**
   * Declared `Promise<void>` by llama.rn, and it is not one.
   *
   * The JSI host function sets an interrupt flag and returns
   * `jsi::Value::undefined()` synchronously (RNLlamaJSI.cpp), and it reaches
   * that flag through `getContextOrThrow`, which *throws* — also
   * synchronously — once the context has been released. So this call can
   * return undefined or raise, and can never be awaited or `.catch()`ed.
   * Typed here for what it does rather than what it claims.
   */
  stopCompletion(): void | Promise<void>;
  release(): Promise<void>;
}

/**
 * Interrupt any decode in flight, and never fail doing it.
 *
 * `active.stopCompletion().catch(() => undefined)` looks like defensive code
 * and is the opposite: `stopCompletion` returns undefined, so the `.catch`
 * threw `TypeError: Cannot read property 'catch' of undefined` on every call.
 *
 * In `dispose()` that TypeError escaped an unawaited effect cleanup as an
 * unhandled rejection — visible as a red box on any hot reload — and, worse,
 * it aborted `dispose()` before `release()`, leaking a native context holding
 * roughly a gigabyte of weights. The visible symptom was a console error; the
 * cost was that every reload loaded another copy of the model.
 *
 * Stopping is advisory in both callers — the context is about to be released,
 * or the caller has already abandoned the stream — so a failure here is
 * genuinely nothing to report.
 */
function stopQuietly(context: LlamaContext): void {
  try {
    void Promise.resolve(context.stopCompletion()).catch(() => undefined);
  } catch {
    // Context already released: getContextOrThrow threw "Context not found".
  }
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

/**
 * Turn llama.cpp's terser failures into something a user can act on.
 *
 * "Context is full" is what it throws when the prompt alone exceeds `n_ctx`,
 * and it reached the chat verbatim — as an assistant message reading
 * "Context is full", which says nothing about whose context, why, or what to
 * do. The prompt is dominated by the tool list, so the actionable fact is that
 * there is too much to describe, not that something went wrong mid-answer.
 */
function describeCompletionFailure(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/context is full/iu.test(message)) {
    return new OnDeviceUnavailableError(
      'the prompt is larger than the model\'s context window — too many tools ' +
        'or too long a conversation for on-device inference',
    );
  }
  return error instanceof Error ? error : new Error(message);
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

  // Guard against a prepare()/dispose() race: if the engine is disposed (or a
  // newer prepare() supersedes the in-flight one) while `initLlama` is still
  // running, the late result must be released immediately and never assigned.
  let lifecycleGeneration = 0;
  let disposed = false;

  // A native context can only serve one decode loop at a time. Two
  // independent consumers must not share it uncontrolled.
  let generating = false;

  return {
    id: 'creepyim-on-device',
    label: 'On-device model',
    isReady: () => context !== null && !disposed,

    prepare() {
      if (disposed) {
        return Promise.reject(
          new OnDeviceUnavailableError('engine has been disposed'),
        );
      }
      // Concurrent screens may both trigger preparation; share one load.
      if (context) return Promise.resolve();
      if (preparing) return preparing;

      const generation = lifecycleGeneration;

      preparing = (async () => {
        const binding = loadBinding();
        if (!binding) {
          throw new OnDeviceUnavailableError(
            'the llama.rn native module is not present in this build',
          );
        }
        const created = await binding.initLlama({
          model: modelPath,
          n_ctx: contextSize,
          n_gpu_layers: gpuLayers,
        });

        // The engine was disposed or a newer preparation took over while the
        // native init was running — release this context so it never leaks.
        if (disposed || generation !== lifecycleGeneration) {
          await created.release().catch(() => undefined);
          return;
        }

        context = created;
      })().finally(() => {
        preparing = null;
      });

      return preparing;
    },

    async *generate(
      prompts: EnginePrompt[],
      options: EngineGenerateOptions = {},
    ) {
      if (disposed) throw new OnDeviceUnavailableError('engine has been disposed');
      if (!context) throw new OnDeviceUnavailableError('context not initialised');

      // Do not start native inference for an already-aborted request.
      if (options.signal?.aborted) return;

      // Reject a second concurrent generation rather than letting two
      // consumers drive the same native context.
      if (generating) {
        throw new OnDeviceUnavailableError(
          'engine is already running a generation',
        );
      }
      generating = true;

      const active = context;

      const queue = new AsyncQueue<string>();

      const onAbort = () => {
        stopQuietly(active);
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
        .catch((error: unknown) => queue.fail(describeCompletionFailure(error)));

      try {
        yield* queue.drain();
      } finally {
        generating = false;
        options.signal?.removeEventListener('abort', onAbort);
      }
    },

    async dispose() {
      disposed = true;
      lifecycleGeneration += 1;

      const active = context;
      context = null;
      if (active) {
        // Best-effort: interrupt any in-flight decode, then release. `release`
        // is a real promise (it waits for outstanding tasks on the context
        // before deleting it); `stopCompletion` is not — see stopQuietly.
        stopQuietly(active);
        await active.release().catch(() => undefined);
      }
    },
  };
}
