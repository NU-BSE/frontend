/**
 * Google Identity Authorization bridge (Android).
 *
 * The connector package stays platform-neutral: it only knows this interface.
 * The real implementation is a native module (Google Play Services
 * `AuthorizationClient`) provided by the app layer; tests inject a fake.
 *
 * Google's recommended Android flow: call `authorize()` when user data access
 * is needed — if permissions are already granted, a fresh access token is
 * returned without a consent UI. No long-lived refresh token is stored on the
 * device; each tool call obtains a new short-lived access token.
 */
export interface GoogleAuthorizationBridge {
  authorize(input: {
    scopes: string[];
    accountName?: string;
    selectAccount?: boolean;
  }): Promise<{ accessToken: string; grantedScopes: string[] }>;

  getAccessToken(input: {
    scopes: string[];
    accountName?: string;
  }): Promise<{ accessToken: string; grantedScopes: string[] }>;

  clearToken(accessToken: string): Promise<void>;

  revoke(input: { accountName?: string; scopes: string[] }): Promise<void>;
}
