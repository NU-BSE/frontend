import { readFileSync } from 'node:fs';
import { GoogleAuth, type AuthClient } from 'google-auth-library';
import Config from '../../../config/attestation.config';
import type { PlayIntegrityDecoded, PlayIntegrityVerifier } from './verify';

const PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';

export class PlayIntegrityError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PlayIntegrityError';
  }
}

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

/**
 * Reads the service-account key from configuration. Inline JSON (or base64 of
 * it) wins over a key file; if neither is set, Application Default Credentials
 * are used, which is what you want on GCE/GKE/Cloud Run with a bound service
 * account.
 */
export const loadGoogleServiceAccount = ():
  | ServiceAccountCredentials
  | undefined => {
  const inline = Config.google.serviceAccountJson;
  const raw = inline
    ? inline.trimStart().startsWith('{')
      ? inline
      : Buffer.from(inline, 'base64').toString('utf8')
    : Config.google.serviceAccountKeyFile
      ? readFileSync(Config.google.serviceAccountKeyFile, 'utf8')
      : undefined;
  if (!raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Google service-account key is not valid JSON: ${String(error)}`,
    );
  }
  const credentials = parsed as Partial<ServiceAccountCredentials>;
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      'Google service-account key must contain client_email and private_key',
    );
  }
  return {
    client_email: credentials.client_email,
    // Secret managers routinely escape the newlines inside the PEM.
    private_key: credentials.private_key.replace(/\\n/gu, '\n'),
    ...(credentials.project_id ? { project_id: credentials.project_id } : {}),
  };
};

/**
 * Decodes Play Integrity tokens server-side through Google's
 * `decodeIntegrityToken` endpoint using a service account. The token is never
 * decoded locally — only Google can decrypt and verify it.
 */
export class GooglePlayIntegrityVerifier implements PlayIntegrityVerifier {
  private readonly auth: GoogleAuth;
  private clientPromise?: Promise<AuthClient>;

  constructor(
    private readonly packageName = Config.android.packageName,
    credentials = loadGoogleServiceAccount(),
    private readonly timeoutMs = 10_000,
  ) {
    this.auth = new GoogleAuth({
      scopes: [PLAY_INTEGRITY_SCOPE],
      ...(credentials ? { credentials } : {}),
    });
  }

  private client(): Promise<AuthClient> {
    this.clientPromise ??= this.auth.getClient();
    return this.clientPromise;
  }

  async decodeIntegrityToken(token: string): Promise<PlayIntegrityDecoded> {
    if (!Config.android.playIntegrityProjectNumber) {
      throw new PlayIntegrityError(
        'ATTESTATION_ANDROID_PLAY_INTEGRITY_PROJECT_NUMBER is required',
        false,
      );
    }
    if (!token) {
      throw new PlayIntegrityError('Integrity token is empty', false);
    }

    const url = `https://playintegrity.googleapis.com/v1/${encodeURIComponent(
      this.packageName,
    )}:decodeIntegrityToken`;

    let response;
    try {
      const client = await this.client();
      response = await client.request<{
        tokenPayloadExternal?: PlayIntegrityDecoded;
      }>({
        url,
        method: 'POST',
        data: { integrityToken: token },
        timeout: this.timeoutMs,
      });
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      // 5xx / transport failures are transient; other 4xx codes mean the token
      // or the configuration is wrong and retrying will not help.
      const retryable = status === undefined || status >= 500 || status === 429;
      throw new PlayIntegrityError(
        `Play Integrity decodeIntegrityToken failed${
          status ? ` with HTTP ${status}` : ''
        }: ${(error as Error).message}`,
        retryable,
      );
    }

    const payload = response.data.tokenPayloadExternal;
    if (!payload) {
      throw new PlayIntegrityError(
        'Play Integrity response did not contain tokenPayloadExternal',
        true,
      );
    }
    return payload;
  }
}
