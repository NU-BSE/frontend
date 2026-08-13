import { GOOGLE_MCP_SCOPES, type GoogleAuthorizationBridge } from '@mobile-agent/connector-google';

import { GOOGLE_USERINFO_ENDPOINT } from './config';
import { getGoogleAuthorizationBridge } from './native-bridge';

export interface GoogleTokens {
  accessToken: string;
  grantedScopes: string[];
}

export interface GoogleIdentity {
  email?: string;
  name?: string;
  sub?: string;
}

export class GoogleAuthCancelled extends Error {
  constructor() {
    super('Google sign-in was cancelled.');
    this.name = 'GoogleAuthCancelled';
  }
}

/**
 * Run the Google Identity authorization flow via the native bridge.
 *
 * `AuthorizationClient.authorize()` prompts for consent only when the user has
 * not yet granted the requested scopes; otherwise it returns a fresh
 * short-lived access token without UI. No refresh token is returned or stored.
 *
 * Identity (`sub`, email, name) is resolved from the userinfo endpoint using
 * the access token, because `AuthorizationResult` does not carry the account
 * identity on its own.
 */
export async function authorizeGoogle(): Promise<{
  tokens: GoogleTokens;
  identity: GoogleIdentity;
}> {
  const bridge = getGoogleAuthorizationBridge();
  if (!bridge) {
    throw new Error(
      'Google sign-in is unavailable on this platform (no native authorization bridge).',
    );
  }

  const { accessToken, grantedScopes } = await bridge.authorize({
    scopes: [...GOOGLE_MCP_SCOPES],
    selectAccount: true,
  });

  const identity = await fetchIdentity(accessToken);
  return { tokens: { accessToken, grantedScopes }, identity };
}

/** Re-mint a token for an already-connected account (no consent UI). */
export async function getGoogleAccessToken(
  bridge: GoogleAuthorizationBridge,
  accountName?: string,
): Promise<{ accessToken: string; grantedScopes: string[] }> {
  return bridge.getAccessToken({
    scopes: [...GOOGLE_MCP_SCOPES],
    ...(accountName ? { accountName } : {}),
  });
}

async function fetchIdentity(accessToken: string): Promise<GoogleIdentity> {
  try {
    const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return {};
    const json = (await response.json()) as GoogleIdentity;
    return {
      ...(json.email ? { email: json.email } : {}),
      ...(json.name ? { name: json.name } : {}),
      ...(json.sub ? { sub: json.sub } : {}),
    };
  } catch {
    return {};
  }
}
