import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import {
  GOOGLE_DISCOVERY,
  GOOGLE_SCOPES,
  googleClientId,
  googleRedirectUri,
} from './config';

/**
 * Finish any auth session left open by a previous attempt. Safe to call more
 * than once, and required on Android so a dismissed browser tab does not keep
 * the next attempt from resolving.
 */
WebBrowser.maybeCompleteAuthSession();

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch millis. Absent when Google omits `expires_in`. */
  accessTokenExpiresAt?: number;
  scopes: string[];
  tokenType?: string;
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
 * Run the Google authorization-code flow with PKCE.
 *
 * Android OAuth clients have no secret, so PKCE is what stops an app that
 * registers the same redirect scheme from redeeming an intercepted code: the
 * verifier never leaves this process, and the token endpoint refuses an
 * exchange whose verifier does not hash to the challenge sent up front.
 *
 * `expo-auth-session` generates and carries the verifier when
 * `usePKCE` is left at its default, and `exchangeCodeAsync` sends it back.
 */
export async function authorizeGoogle(): Promise<{
  tokens: GoogleTokens;
  identity: GoogleIdentity;
}> {
  const clientId = googleClientId();
  const redirectUri = googleRedirectUri();

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    scopes: [...GOOGLE_SCOPES],
    responseType: AuthSession.ResponseType.Code,
    /*
     * `offline` is what makes Google return a refresh token, and `consent`
     * forces the consent screen so a re-connect after disconnecting still
     * yields one — Google omits the refresh token on silent re-authorization,
     * which would leave the connection unable to outlive its access token.
     */
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });

  const result = await request.promptAsync(GOOGLE_DISCOVERY);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new GoogleAuthCancelled();
  }
  if (result.type === 'error') {
    throw new Error(
      result.params.error_description ??
        result.error?.message ??
        'Google returned an authorization error.',
    );
  }
  if (result.type !== 'success' || !result.params.code) {
    throw new Error('Google did not return an authorization code.');
  }

  const exchanged = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      redirectUri,
      code: result.params.code,
      extraParams: request.codeVerifier
        ? { code_verifier: request.codeVerifier }
        : {},
    },
    GOOGLE_DISCOVERY,
  );

  const tokens: GoogleTokens = {
    accessToken: exchanged.accessToken,
    scopes: exchanged.scope ? exchanged.scope.split(' ') : [...GOOGLE_SCOPES],
    ...(exchanged.refreshToken ? { refreshToken: exchanged.refreshToken } : {}),
    ...(exchanged.tokenType ? { tokenType: exchanged.tokenType } : {}),
    ...(exchanged.expiresIn
      ? { accessTokenExpiresAt: Date.now() + exchanged.expiresIn * 1000 }
      : {}),
  };

  return { tokens, identity: await fetchIdentity(tokens.accessToken) };
}

/**
 * Read the account's display identity so the connection tile can name it.
 *
 * Failure here is not fatal: the grant is already valid, and a connection
 * labelled "Google" is better than discarding a completed authorization
 * because a cosmetic lookup failed.
 */
async function fetchIdentity(accessToken: string): Promise<GoogleIdentity> {
  try {
    const response = await fetch(GOOGLE_DISCOVERY.userInfoEndpoint, {
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

/** Best-effort revocation so disconnecting also ends the grant at Google. */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(GOOGLE_DISCOVERY.revocationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(token)}`,
    });
  } catch {
    // The local credential is deleted regardless; a stale grant at Google is
    // better than a connection the user cannot remove.
  }
}
