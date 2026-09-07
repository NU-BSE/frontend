/**
 * Dynamic Expo configuration.
 *
 * Google sign-in uses Google Play Services `AuthorizationClient` (identified by
 * package name + SHA-1 signing certificate), so no OAuth redirect scheme is
 * registered in the manifest. The base static config lives in `app.json`; this
 * file only pins the app's own scheme.
 */
const AttestationConfig = require('./config/attestation.config');

module.exports = ({ config }) => {
  return {
    ...config,
    scheme: ['creepyim'],
    /*
     * `process.env` works here and does not work inside the RN bundle:
     * babel-preset-expo inlines only `EXPO_PUBLIC_*`, and only as literal
     * member expressions, so the config's dynamic lookups would silently
     * resolve to their fallbacks on device — `serverBaseUrl` becoming
     * localhost, which points the phone at itself. Baking the public subset in
     * at build time is what `client/runtimeConfig.ts` already reads.
     *
     * Only `public`: no bot token, no service account, no signing key. Anyone
     * can unpack an APK.
     */
    extra: {
      ...config.extra,
      attestation: AttestationConfig.public,
    },
  };
};
