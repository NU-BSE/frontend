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
 * require per call would put module resolution on every bridge call. The
 * caching is safe with React Native's initialization order because the modules
 * queried here are registered synchronously when the native app starts — before
 * the JS bundle runs — so a first resolution that happens "too early" still
 * sees them. An expected module that resolves null is genuinely absent from the
 * build; `getNativeModuleDiagnostics` reports that as MODULE_NOT_LINKED so a
 * missing module is never mistaken for a missing user permission.
 */

const cache = new Map<string, unknown>();

let platform: 'android' | 'other' | null = null;

function resolvePlatform(): 'android' | 'other' {
  if (platform !== null) return platform;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native') as typeof import('react-native');
    platform = Platform.OS === 'android' ? 'android' : 'other';
  } catch {
    // Node, or a platform without react-native. Absent is a normal answer.
    platform = 'other';
  }
  return platform;
}

export function getNativeModule<T>(name: string): T | null {
  if (cache.has(name)) return cache.get(name) as T | null;

  let resolved: T | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require('react-native') as typeof import('react-native');
    resolved =
      resolvePlatform() === 'android'
        ? ((NativeModules as Record<string, unknown>)[name] as T | undefined) ?? null
        : null;
  } catch {
    resolved = null;
  }

  cache.set(name, resolved);
  return resolved;
}

export type NativeModuleDiagnosticsReason =
  | 'AVAILABLE'
  | 'MODULE_NOT_LINKED'
  | 'PLATFORM_UNSUPPORTED';

export interface NativeModuleDiagnostics {
  /** The platform the resolver saw when it looked. */
  platform: 'android' | 'other';
  present: boolean;
  reason: NativeModuleDiagnosticsReason;
}

/**
 * Whether an expected Android native module is actually linked into this build.
 *
 * The critical distinction this exposes: a module that is simply absent from
 * the APK (MODULE_NOT_LINKED) is a build/linking problem to be surfaced in
 * diagnostics, NOT a user permission to be granted. Callers that only need the
 * module itself should keep using `getNativeModule`; this is for diagnostics
 * and dev-tooling.
 */
export function getNativeModuleDiagnostics(
  name: string,
): NativeModuleDiagnostics {
  // Force the resolution so `queried` is true and the cache reflects reality.
  getNativeModule(name);
  const currentPlatform = resolvePlatform();
  const resolved = cache.get(name) as unknown | null;
  if (currentPlatform !== 'android') {
    return { platform: currentPlatform, present: false, reason: 'PLATFORM_UNSUPPORTED' };
  }
  if (resolved != null) {
    return { platform: currentPlatform, present: true, reason: 'AVAILABLE' };
  }
  return { platform: currentPlatform, present: false, reason: 'MODULE_NOT_LINKED' };
}