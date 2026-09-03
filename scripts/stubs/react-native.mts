/**
 * The sliver of react-native these verification scripts touch.
 *
 * Importing the real package under plain Node fails on Flow syntax in its
 * entry file, so anything reachable from a script has to be stubbed rather
 * than externalised.
 */
export const Platform = { OS: 'android', select: <T,>(spec: { android?: T; default?: T }) =>
  spec.android ?? spec.default } as const;
