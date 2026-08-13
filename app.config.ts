import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo configuration.
 *
 * Google sign-in uses Google Play Services `AuthorizationClient` (identified by
 * package name + SHA-1 signing certificate), so no OAuth redirect scheme is
 * registered in the manifest. The base static config lives in `app.json`; this
 * file only pins the app's own scheme.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    scheme: ['creepyim'],
  };
};
