import type { CredentialVault, OAuthCredential } from '@mobile-agent/credential-vault';
import type { ConnectionStore } from '@mobile-agent/connector-core';
import type { AccessTokenProvider } from './types';

export interface OAuthTokenRefreshInput {
  connectionId: string;
  refreshToken: string;
  scopes: string[];
}

/**
 * Provider-specific token exchange. Each provider owns its token endpoint,
 * client id, PKCE configuration, scopes and error mapping; oauth-core keeps
 * only the generic refresh locking and vault bookkeeping.
 *
 * Providers that require a confidential client secret must route through the
 * project's OAuth broker/backend — a client secret is never bundled into the
 * APK.
 */
export interface OAuthTokenEndpoint {
  readonly providerId: string;
  refresh(input: OAuthTokenRefreshInput): Promise<OAuthCredential>;
}

/**
 * Explicitly labeled development double. Real refreshes must go through a
 * provider endpoint; this exists only so tests and dev builds can exercise
 * the refresh plumbing without a network.
 */
export function createDevFakeTokenEndpoint(
  providerId: string,
): OAuthTokenEndpoint {
  return {
    providerId,
    async refresh({ connectionId }) {
      return {
        kind: 'oauth',
        accessToken: `dev-refreshed-${connectionId}-${Date.now()}`,
        accessTokenExpiresAt: Date.now() + 3_600_000,
        scopes: [],
      };
    },
  };
}

export interface AccessTokenProviderOptions {
  /** Required for real refreshes; omit only in tests/dev. */
  tokenEndpoint?: OAuthTokenEndpoint;
}

export function createAccessTokenProvider(
  connectionStore: ConnectionStore,
  vault: CredentialVault,
  options: AccessTokenProviderOptions = {},
): AccessTokenProvider {
  // One in-flight refresh per connection: concurrent callers share the same
  // exchange instead of racing the token endpoint.
  const refreshLocks = new Map<string, Promise<string>>();
  const REFRESH_BUFFER_MS = 60_000;

  return {
    async getValidAccessToken(connectionId: string): Promise<string> {
      const connection = await connectionStore.get(connectionId);
      if (!connection?.credentialReference) {
        throw new Error('Connection not found or has no stored credentials');
      }

      const cred = await vault.get(connection.credentialReference);
      if (!cred || cred.kind !== 'oauth') {
        throw new Error('No valid OAuth credential found');
      }

      const oauth = cred as OAuthCredential;

      if (oauth.accessTokenExpiresAt && Date.now() < oauth.accessTokenExpiresAt - REFRESH_BUFFER_MS) {
        return oauth.accessToken;
      }

      const existing = refreshLocks.get(connectionId);
      if (existing) return existing;

      const refreshPromise = (async () => {
        try {
          if (!oauth.refreshToken) throw new Error('No refresh token');
          if (!options.tokenEndpoint) {
            throw new Error(
              'No OAuth token endpoint is configured for this provider. ' +
                'Token refresh requires the provider-specific exchange ' +
                '(via the OAuth broker); fake refreshes are not allowed.',
            );
          }

          const refreshed = await options.tokenEndpoint.refresh({
            connectionId,
            refreshToken: oauth.refreshToken,
            scopes: oauth.scopes,
          });

          await vault.save(connection.credentialReference!, {
            ...oauth,
            ...refreshed,
            kind: 'oauth',
            refreshToken: refreshed.refreshToken ?? oauth.refreshToken,
          });

          return refreshed.accessToken;
        } finally {
          refreshLocks.delete(connectionId);
        }
      })();

      refreshLocks.set(connectionId, refreshPromise);
      return refreshPromise;
    },
  };
}
