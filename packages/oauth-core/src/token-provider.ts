import type { CredentialVault, OAuthCredential } from '@mobile-agent/credential-vault';
import type { ConnectionStore } from '@mobile-agent/connector-core';
import type { AccessTokenProvider } from './types';

export function createAccessTokenProvider(
  connectionStore: ConnectionStore,
  vault: CredentialVault,
): AccessTokenProvider {
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
          const newToken = `refreshed-${connectionId}-${Date.now()}`;
          const newExpiry = Date.now() + 3_600_000;

          await vault.save(connection.credentialReference!, {
            ...oauth,
            accessToken: newToken,
            accessTokenExpiresAt: newExpiry,
          });

          return newToken;
        } finally {
          refreshLocks.delete(connectionId);
        }
      })();

      refreshLocks.set(connectionId, refreshPromise);
      return refreshPromise;
    },
  };
}
