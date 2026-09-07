/**
 * The on-device engine's lifecycle, against a stub that copies llama.rn's
 * real contract rather than its declared one.
 *
 * The bug this exists for reached a phone: `dispose()` did
 *
 *     await active.stopCompletion().catch(() => undefined)
 *
 * which reads as defensive and is the opposite. `stopCompletion` returns
 * `undefined`, so `.catch` threw `TypeError: Cannot read property 'catch' of
 * undefined` on *every* call. In an effect cleanup that surfaced as an
 * unhandled rejection — a red box on any hot reload — and, far worse, it
 * aborted `dispose()` one line before `release()`. Every reload leaked a
 * native context holding about a gigabyte of weights.
 *
 * So the assertion that matters is not "dispose does not throw" but "release
 * was actually reached".
 *
 * Run: npm run verify:on-device
 */
import {
  createOnDeviceEngine,
  isOnDeviceSupported,
} from '../src/ai/engines/onDeviceEngine.js';

/**
 * The stub is substituted for `llama.rn` by esbuild's `--alias`, so it is
 * never imported here; it publishes what it recorded on `globalThis`. See
 * scripts/stubs/llama-rn.mts.
 */
interface StubContext {
  released: boolean;
  stopCalls: number;
  releaseCalls: number;
}

function stubContexts(): StubContext[] {
  const slot = globalThis as { __llamaStubContexts?: StubContext[] };
  slot.__llamaStubContexts ??= [];
  return slot.__llamaStubContexts;
}

function resetStubContexts(): void {
  stubContexts().length = 0;
}

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  ok — ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL — ${message}`);
  }
}

async function main(): Promise<void> {
  console.log('the stub reproduces the native contract:');
  {
    resetStubContexts();
    const engine = createOnDeviceEngine({ modelPath: '/tmp/model.gguf' });
    await engine.prepare();
    const [context] = stubContexts();
    assert(context !== undefined, 'prepare() creates exactly one native context');
    assert(engine.isReady(), 'the engine reports ready once prepared');
  }

  console.log('\ndispose reaches release:');
  {
    resetStubContexts();
    const engine = createOnDeviceEngine({ modelPath: '/tmp/model.gguf' });
    await engine.prepare();

    let threw: unknown = null;
    try {
      await engine.dispose?.();
    } catch (error) {
      threw = error;
    }

    const [context] = stubContexts();
    assert(threw === null, 'dispose() does not throw on a synchronous stopCompletion');
    assert(context?.stopCalls === 1, 'the in-flight decode is interrupted');
    assert(
      context?.releaseCalls === 1,
      'release() is reached — this is the gigabyte that used to leak per reload',
    );
    assert(!engine.isReady(), 'the engine reports not ready after disposal');
  }

  console.log('\ndisposing twice is safe:');
  {
    resetStubContexts();
    const engine = createOnDeviceEngine({ modelPath: '/tmp/model.gguf' });
    await engine.prepare();
    await engine.dispose?.();

    // The second dispose has no context to stop; a stopCompletion that throws
    // "Context not found" must not turn a no-op into a rejection.
    let threw: unknown = null;
    try {
      await engine.dispose?.();
    } catch (error) {
      threw = error;
    }
    assert(threw === null, 'a second dispose() resolves rather than rejecting');
    assert(
      stubContexts()[0]?.releaseCalls === 1,
      'the context is released once, not twice',
    );
  }

  console.log('\naborting a generation does not reject:');
  {
    resetStubContexts();
    const engine = createOnDeviceEngine({ modelPath: '/tmp/model.gguf' });
    await engine.prepare();

    const controller = new AbortController();
    const stream = engine.generate([{ role: 'user', content: 'hi' }], {
      signal: controller.signal,
    });

    // Start the generator so the abort listener is attached, then abort. The
    // stub's completion never settles, so the queue closing is what ends it.
    const drained = (async () => {
      for await (const _token of stream) {
        // no tokens arrive from the stub
      }
    })();

    await Promise.resolve();
    controller.abort();

    let threw: unknown = null;
    try {
      await drained;
    } catch (error) {
      threw = error;
    }

    assert(threw === null, 'aborting mid-generation ends the stream cleanly');
    assert(
      stubContexts()[0]?.stopCalls === 1,
      'abort interrupts the native decode exactly once',
    );

    await engine.dispose?.();
  }

  console.log('\nsupport detection:');
  assert(isOnDeviceSupported(), 'the binding is detected when the module is present');

  if (failures > 0) {
    console.error(`\non-device engine: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nverify:on-device — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
