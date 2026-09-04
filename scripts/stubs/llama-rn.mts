/**
 * A stand-in for `llama.rn` that copies the native module's real contract,
 * including where its TypeScript declarations are wrong.
 *
 * `stopCompletion` is declared `Promise<void>` by the package and is not one.
 * Its JSI host function (RNLlamaJSI.cpp) sets an interrupt flag and returns
 * `jsi::Value::undefined()` synchronously, reaching that flag through
 * `getContextOrThrow`, which throws — also synchronously — once the context
 * has been released. Both behaviours are reproduced here, because a stub that
 * returned a tidy promise would make the engine look correct while the phone
 * threw `TypeError: Cannot read property 'catch' of undefined` on every
 * dispose.
 */

export interface StubContext {
  released: boolean;
  stopCalls: number;
  releaseCalls: number;
}

/**
 * State is published on `globalThis` rather than exported.
 *
 * The engine reaches this file through esbuild's `--alias:llama.rn=...`, so
 * the test cannot import it by path without TypeScript objecting to a `.mts`
 * specifier, and cannot import it as `llama.rn` without inventing exports on
 * the real package's types. A global is the one channel both halves share.
 */
/**
 * The engine `require`s `llama.rn` lazily, so this module is first evaluated
 * partway through a test. It adopts whatever array is already there rather
 * than replacing it, or the reset the test just performed would be discarded.
 */
const slot = globalThis as { __llamaStubContexts?: StubContext[] };
slot.__llamaStubContexts ??= [];
const contexts = slot.__llamaStubContexts;

export function initLlama(_options: Record<string, unknown>): Promise<unknown> {
  const state: StubContext = {
    released: false,
    stopCalls: 0,
    releaseCalls: 0,
  };
  contexts.push(state);

  return Promise.resolve({
    completion: () => new Promise(() => undefined),

    // Synchronous, returns undefined, throws after release. As the real one does.
    stopCompletion(): void {
      state.stopCalls += 1;
      if (state.released) throw new Error('Context not found');
    },

    release(): Promise<void> {
      state.releaseCalls += 1;
      state.released = true;
      return Promise.resolve();
    },
  });
}
