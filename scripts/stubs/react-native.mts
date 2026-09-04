/**
 * The sliver of react-native these verification scripts touch.
 *
 * Importing the real package under plain Node fails on Flow syntax in its
 * entry file, so anything reachable from a script has to be stubbed rather
 * than externalised.
 */
export const Platform = { OS: 'android', select: <T,>(spec: { android?: T; default?: T }) =>
  spec.android ?? spec.default } as const;

/*
 * Reached through `expo-modules-core`, which any expo package imports on the
 * way in. Nothing in these scripts calls a native module — the modules under
 * test are the pure ones — so these exist to satisfy the bundler and throw if
 * that ever stops being true.
 */
export const TurboModuleRegistry = {
  get: () => null,
  getEnforcing: (name: string) => {
    throw new Error(`native module "${name}" is not available under Node`);
  },
};

export class NativeEventEmitter {
  addListener() {
    return { remove: () => undefined };
  }
  removeAllListeners() {}
}
