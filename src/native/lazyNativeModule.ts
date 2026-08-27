/**
 * Reaching a native module without importing react-native at module scope.
 *
 * The Node verification scripts bundle app code with `--external:react-native`,
 * so a top-level `import ... from 'react-native'` becomes a real require at run
 * time and Node chokes on that package's Flow syntax. Anything touching a
 * native module therefore resolves it lazily behind a guarded require — the
 * same pattern settings-native-bridge.ts already used, and which three new
 * modules broke by importing directly.
 *
 * The result is cached: it cannot change while the process lives, and a
 * require per call would put module resolution on every bridge call.
 */

const cache = new Map<string, unknown>();

export function getNativeModule<T>(name: string): T | null {
  if (cache.has(name)) return cache.get(name) as T | null;

  let resolved: T | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules, Platform } = require('react-native') as typeof import('react-native');
    resolved =
      Platform.OS === 'android'
        ? ((NativeModules as Record<string, unknown>)[name] as T | undefined) ?? null
        : null;
  } catch {
    // Node, or a platform without react-native. Absent is a normal answer.
    resolved = null;
  }

  cache.set(name, resolved);
  return resolved;
}
