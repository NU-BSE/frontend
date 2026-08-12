/**
 * Google OAuth configuration.
 *
 * The client id is public by design: Android OAuth clients have no client
 * secret, and Google authenticates the caller by package name plus the signing
 * certificate's SHA-1 registered in the Cloud console. That is why the flow
 * below uses PKCE — the code verifier, not a secret, is what binds the token
 * exchange to this app.
 *
 * The SHA-1 fingerprint itself is never read at runtime. It matters only when
 * registering the client in the console. (`EXPO_PUBLIC_SHA-1` in `.env` cannot
 * be read from JavaScript anyway: `process.env.EXPO_PUBLIC_SHA-1` parses as a
 * subtraction, and Expo only inlines dot-accessible names.)
 */

import { googleSchemeFromClientId } from './scheme';

const CLIENT_ID = (process.env.EXPO_PUBLIC_OAUTH ?? '').trim();

/** Whether Google sign-in can be attempted at all. */export const isGoogleOAuthConfigured = (): boolean => CLIENT_ID.length > 0;

export const googleClientId = (): string => {
  if (!CLIENT_ID) {
    throw new Error(
      'Google sign-in is not configured: set EXPO_PUBLIC_OAUTH to the Android ' +
        'OAuth client id from the Google Cloud console.',
    );
  }
  return CLIENT_ID;
};

/**
 * Google requires Android clients to redirect to the reverse-DNS form of the
 * client id, derived from a single source of truth so it cannot drift from the
 * client id it must match. The same helper feeds the Expo config generation so
 * the Android manifest always carries the scheme for the client id in use.
 */
export const googleRedirectScheme = (): string =>
  googleSchemeFromClientId(googleClientId());

export const googleRedirectUri = (): string =>
  `${googleRedirectScheme()}:/oauth2redirect`;

/**
 * Scopes requested at connect time.
 *
 * Deliberately the read-only subset that the currently implemented Google
 * tools need. Write scopes (sending mail, deleting events) are not requested
 * until those tools are wired to the real API — an unused write grant is a
 * standing risk with no benefit.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
] as const;

export const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  userInfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
} as const;
