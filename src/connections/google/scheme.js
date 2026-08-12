/**
 * Pure derivation of the Google OAuth redirect scheme.
 *
 * Google requires Android OAuth clients to redirect to the reverse-DNS form of
 * the client id: `com.googleusercontent.apps.<id>`. This helper has no React
 * Native / Expo imports so it can be shared by:
 *
 *   1. the runtime OAuth config (`src/connections/google/config.ts`);
 *   2. the Expo config generation (`app.config.ts`);
 *   3. Node verification scripts.
 *
 * Written as CommonJS so Expo's config loader (Node `require`) and the app's
 * Metro bundler can both consume it without a TypeScript transpile step.
 * The scheme is *derived* rather than configured so it can never drift from
 * the client id it must match — a mismatch fails late, inside the browser,
 * with an opaque `redirect_uri_mismatch`.
 *
 * @param {string} clientId - Google OAuth client id (e.g. `123-abc.apps.googleusercontent.com`).
 * @returns {string} The reverse-DNS redirect scheme.
 */
function googleSchemeFromClientId(clientId) {
  return `com.googleusercontent.apps.${clientId.replace(
    /\.apps\.googleusercontent\.com$/u,
    '',
  )}`;
}

module.exports = { googleSchemeFromClientId };
