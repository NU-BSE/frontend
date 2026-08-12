import type { ConfigContext, ExpoConfig } from 'expo/config';

import { googleSchemeFromClientId } from './src/connections/google/scheme.js';

/**
 * Dynamic Expo configuration.
 *
 * The Google OAuth redirect scheme is derived from the same client id that the
 * runtime uses, so changing `EXPO_PUBLIC_OAUTH` re-derives the Android
 * manifest scheme instead of leaving a stale hardcoded one behind. A plain
 * `expo prebuild` is then sufficient.
 *
 * The base static config lives in `app.json`; this file only overrides the
 * `scheme` array.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const clientId = (process.env.EXPO_PUBLIC_OAUTH ?? '').trim();
  const googleScheme = clientId ? googleSchemeFromClientId(clientId) : null;

  return {
    ...config,
    scheme: googleScheme ? ['creepyim', googleScheme] : ['creepyim'],
  };
};
