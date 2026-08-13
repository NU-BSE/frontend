export interface OAuthCredential {
  kind: 'oauth';
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  tokenType?: string;
  scopes: string[];
  /**
   * Provider account identity used to select the right account when minting a
   * fresh token (e.g. the Google account email for `AuthorizationClient`).
   * Identity metadata, not a secret.
   */
  accountName?: string;
}

export interface StaticTokenCredential {
  kind: 'static_token';
  token: string;
}

export interface TdlibCredential {
  kind: 'tdlib';
  databaseKeyReference: string;
}

export type StoredCredential =
  | OAuthCredential
  | StaticTokenCredential
  | TdlibCredential;

export interface CredentialVault {
  save(reference: string, credential: StoredCredential): Promise<void>;
  get(reference: string): Promise<StoredCredential | null>;
  remove(reference: string): Promise<void>;
}
