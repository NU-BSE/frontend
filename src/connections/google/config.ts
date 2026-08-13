/**
 * Google connector configuration.
 *
 * The Android identity flow uses Google Play Services `AuthorizationClient`,
 * which authenticates the caller by package name + SHA-1 signing certificate —
 * NOT by an OAuth client id or redirect URI. No client secret exists in the
 * app, and no redirect scheme is registered in the manifest.
 *
 * Only the read-only scopes the currently implemented tools need are requested.
 */
import { GOOGLE_MCP_SCOPES } from '@mobile-agent/connector-google';

export const GOOGLE_SCOPES = [...GOOGLE_MCP_SCOPES];

export const GOOGLE_USERINFO_ENDPOINT =
  'https://openidconnect.googleapis.com/v1/userinfo';
