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

      try {
        const result = await options.bridge.getAccessToken({
          scopes,
          ...(accountName ? { accountName } : {}),
        });
        return result.accessToken;
      } catch (error) {
        // The native bridge rejects with RECONNECT_REQUIRED when Google needs
        // interactive re-consent (e.g. a requested scope is no longer granted).
        // Surface that as a permission error so the caller can prompt the user,
        // rather than leaking a raw native module rejection.
        const code = (error as { code?: string } | null)?.code;
        const message = error instanceof Error ? error.message : String(error);
        if (code === 'RECONNECT_REQUIRED' || /re-consent|reconnect/i.test(message)) {
          throw new ConnectorError(
            'Google permission is required for this account. Ask the user to reconnect and authorize the requested access.',
            'PERMISSION_REQUIRED',
          );
        }
        throw error;
      }
    },
  };
}