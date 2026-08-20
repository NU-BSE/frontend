/**
 * Minimal Google REST transport for the connector package.
 *
 * Platform-neutral: uses an injectable `fetch` and an injected access-token
 * provider, so Node verification scripts can drive it deterministically while
 * the app passes the real fetch and the AuthorizationClient-backed provider.
 */
import { ConnectorError } from '@mobile-agent/connector-core';

export type GoogleApiErrorCode =
  | 'AUTH_REQUIRED'
  | 'RECONNECT_REQUIRED'
  | 'PERMISSION_REQUIRED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR';

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: GoogleApiErrorCode,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

export interface GoogleApiClientDeps {
  /** Returns a valid access token for the connection. */
  getAccessToken: (connectionId: string) => Promise<string>;
  /** Removes an invalid cached token so the next mint returns a fresh one. */
  clearToken?: (accessToken: string) => Promise<void>;
  fetchFn?: typeof fetch;
}

interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Abort signal forwarded to fetch (used for request timeouts). */
  signal?: AbortSignal;
  /** Return the raw response instead of parsed JSON. */
  rawResponse?: boolean;
}

export class GoogleApiClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly deps: GoogleApiClientDeps) {
    this.fetchFn = deps.fetchFn ?? ((...args) => fetch(...args));
  }

  async requestJson(
    connectionId: string,
    method: string,
    url: string,
    options: Omit<RequestOptions, 'rawResponse'> = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.request(connectionId, method, url, options);
    return (await this.readJson(response)) as Record<string, unknown>;
  }

  /** Returns the raw response bytes for a download (after 401 retry). */
  async requestBytes(
    connectionId: string,
    method: string,
    url: string,
    options: Omit<RequestOptions, 'rawResponse'> = {},
  ): Promise<{ bytes: Uint8Array; response: Response }> {
    const response = await this.request(connectionId, method, url, options);
    const buffer = await response.arrayBuffer();
    return { bytes: new Uint8Array(buffer), response };
  }

  private async request(
    connectionId: string,
    method: string,
    url: string,
    options: RequestOptions,
  ): Promise<Response> {
    const buildUrl = (): string => {
      if (!options.query) return url;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}${params.toString()}`;
    };

    const buildInit = (token: string): RequestInit => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        ...(options.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(options.headers ?? {}),
      };
      return {
        method,
        headers,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      };
    };

    let token = await this.deps.getAccessToken(connectionId);
    let response = await this.fetchFn(buildUrl(), buildInit(token));

    // A 401 means the cached token was invalid. Clear it, mint a fresh one,
    // and retry exactly once. Never loop.
    if (response.status === 401) {
      await this.deps.clearToken?.(token);
      token = await this.deps.getAccessToken(connectionId);
      response = await this.fetchFn(buildUrl(), buildInit(token));
    }

    return response;
  }

  private async readJson(response: Response): Promise<unknown> {
    if (!response.ok) {
      throw await this.toError(response);
    }
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  private async toError(response: Response): Promise<GoogleApiError> {
    let body: {
      error?: {
        code?: number;
        message?: string;
        status?: string;
        errors?: { reason?: string; message?: string }[];
      };
      message?: string;
    } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Non-JSON error body; fall through with the status.
    }
    const message =
      body?.error?.message ?? body?.message ?? `Google API error ${response.status}`;

    switch (response.status) {
      case 401:
        return new GoogleApiError(message, response.status, 'AUTH_REQUIRED');
      case 403: {
        // A 403 is not always a permission problem: Gmail surfaces
        // `rateLimitExceeded` / `userRateLimitExceeded` under a 403 status for
        // some quota errors. Distinguish them so the model backs off instead
        // of asking the user to re-consent.
        const reasons = (body?.error?.errors ?? []).map((e) => e.reason ?? '');
        if (reasons.some((reason) => /rate/i.test(reason))) {
          return new GoogleApiError(message, response.status, 'RATE_LIMITED');
        }
        return new GoogleApiError(message, response.status, 'PERMISSION_REQUIRED');
      }
      case 404:
        return new GoogleApiError(message, response.status, 'NOT_FOUND');
      case 429:
        return new GoogleApiError(message, response.status, 'RATE_LIMITED');
      default:
        return new GoogleApiError(message, response.status, 'PROVIDER_ERROR');
    }
  }
}

/** Maps a GoogleApiError (and any other error) into a ConnectorError. */
export function mapGoogleError(
  error: unknown,
  context: string,
): ConnectorError {
  // Already a structured connector error (e.g. thrown by the token provider):
  // preserve its code and retryability rather than masking it as a provider
  // failure.
  if (error instanceof ConnectorError) return error;

  if (error instanceof GoogleApiError) {
    switch (error.code) {
      case 'AUTH_REQUIRED':
        return new ConnectorError(
          `Google authorization is no longer valid for ${context}. Reconnect Google.`,
          'AUTH_REQUIRED',
        );
      case 'PERMISSION_REQUIRED':
        return new ConnectorError(
          `Google permission is missing for ${context}. Reconnect Google to grant access.`,
          'PERMISSION_REQUIRED',
        );
      case 'NOT_FOUND':
        return new ConnectorError(error.message, 'NOT_FOUND');
      case 'RATE_LIMITED':
        return new ConnectorError(
          'Google rate-limited this request. Please wait and try again.',
          'RATE_LIMITED',
          true,
        );
      default:
        return new ConnectorError(
          `Google request failed for ${context}: ${error.message}`,
          'PROVIDER_ERROR',
        );
    }
  }

  return new ConnectorError(
    `Google request failed for ${context}.`,
    'PROVIDER_ERROR',
  );
}
