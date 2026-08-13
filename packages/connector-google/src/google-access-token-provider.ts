/**
 * Google token provider for the Android identity flow.
 *
 * The generic `createAccessTokenProvider()` in `oauth-core` is refresh-token
 * based (server-side exchange) and is NOT used here: Google's Android flow
 * re-mints a short-lived access token via `AuthorizationClient` on demand, and
 * no refresh token is stored on the device.
 */
import type { ConnectionStore } from '@mobile-agent/connector-core';
import { ConnectorError } from '@mobile-agent/connector-core';
import type { CredentialVault } from '@mobile-agent/credential-vault';

import type { GoogleAuthorizationBridge } from './google-authorization-bridge';

export interface GoogleAccessTokenProvider {
  getValidAccessToken(connectionId: string): Promise<string>;
}

export interface GoogleAccessTokenProviderOptions {
  connectionStore: ConnectionStore;
  vault?: CredentialVault;
  bridge: GoogleAuthorizationBridge;
}

export function createGoogleAccessTokenProvider(
  options: GoogleAccessTokenProviderOptions,
): GoogleAccessTokenProvider {
  return {
    async getValidAccessToken(connectionId: string): Promise<string> {
      const record = await options.connectionStore.get(connectionId);
      if (!record) {
        throw new ConnectorError(
          `Connection "${connectionId}" was not found.`,
          'NOT_CONNECTED',
        );
      }

      const scopes = record.scopes ?? [];
      let accountName: string | undefined;
      if (options.vault && record.credentialReference) {
        const credential = await options.vault.get(record.credentialReference);
        accountName =
          credential?.kind === 'oauth' ? credential.accountName : undefined;
      }

      const result = await options.bridge.getAccessToken({ scopes, accountName });
      return result.accessToken;
    },
  };
}
