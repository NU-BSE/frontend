import type { GoogleAuthorizationBridge } from '@mobile-agent/connector-google';

type NativeGoogleAuthorizationModule = {
  authorize?: (
    scopes: string[],
    accountName: string | null,
    selectAccount: boolean,
  ) => Promise<{ accessToken: string; grantedScopes: string[] }>;
  getAccessToken?: (
    scopes: string[],
    accountName: string | null,
  ) => Promise<{ accessToken: string; grantedScopes: string[] }>;
  clearToken?: (accessToken: string) => Promise<void>;
  revoke?: (accountName: string | null, scopes: string[]) => Promise<void>;
};

/**
 * Returns the native Google Identity bridge on Android, or null when absent
 * (iOS, web, Node, or a build without the native module).
 *
 * `react-native` is loaded lazily so this module is safe to import in Node
 * verification scripts (the `require` throws there and is caught).
 */
export function getGoogleAuthorizationBridge(): GoogleAuthorizationBridge | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules, Platform } = require('react-native') as typeof import('react-native');
    const module = NativeModules.GoogleAuthorizationModule as
      | NativeGoogleAuthorizationModule
      | undefined;
    if (Platform.OS !== 'android' || !module) return null;

    return {
      authorize: (input) => {
        if (!module.authorize) {
          throw new Error('GoogleAuthorizationModule.authorize is unavailable');
        }
        return module.authorize(
          input.scopes,
          input.accountName ?? null,
          input.selectAccount ?? true,
        );
      },
      getAccessToken: (input) => {
        if (!module.getAccessToken) {
          throw new Error('GoogleAuthorizationModule.getAccessToken is unavailable');
        }
        return module.getAccessToken(input.scopes, input.accountName ?? null);
      },
      clearToken: (accessToken) => {
        if (!module.clearToken) return Promise.resolve();
        return module.clearToken(accessToken);
      },
      revoke: (input) => {
        if (!module.revoke) {
          throw new Error('GoogleAuthorizationModule.revoke is unavailable');
        }
        return module.revoke(input.accountName ?? null, input.scopes);
      },
    };
  } catch {
    return null;
  }
}
