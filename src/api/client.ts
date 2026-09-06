/**
 * API client for the Creepy.IM FastAPI backend.
 *
 * `baseUrl()`/`getToken()` are the shared source of truth for the backend
 * origin and the bearer token, used by the auth endpoints below AND by the
 * remote Agent Chat (`POST /agent/step` via `src/agent/models/remoteAgentModel`).
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { describeHttpFailure } from './httpErrors';

const ACCESS_TOKEN_KEY = 'creepyim.auth.access-token.v1';
const REFRESH_TOKEN_KEY = 'creepyim.auth.refresh-token.v1';

export async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') return sessionStorage.getItem(ACCESS_TOKEN_KEY);
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

async function readRefreshToken(): Promise<string | null> {
  if (Platform.OS === 'web') return sessionStorage.getItem(REFRESH_TOKEN_KEY);
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

async function writeAccessToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
}

/*
 * Access tokens last fifteen minutes. Nothing renewed them.
 *
 * `tryRefreshToken` existed in the auth module and was called by nothing, and
 * `request` had no 401 handling, so every authenticated call failed
 * permanently a quarter of an hour after sign-in while a perfectly good
 * refresh token sat in SecureStore. The paywall's exemption check was one of
 * the casualties: it 401ed, the query gave up, and a demo account that the
 * server said owed nothing was shown the paywall anyway.
 *
 * Single-flight, because a screen that fires three requests at once would
 * otherwise start three refreshes and race to store the results.
 *
 * Exported so callers that do not go through `request` can share the same
 * flight rather than opening their own. The agent posts to /agent/step with a
 * bare `fetch`, and having it refresh independently would mean two refreshes
 * racing on every expiry — and would break outright if the server ever starts
 * rotating refresh tokens.
 */
let refreshInFlight: Promise<string | null> | null = null;

export async function refreshAccessTokenOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const refreshToken = await readRefreshToken();
        if (!refreshToken) return null;
        const result = await request<{ accessToken: string }>(
          'POST',
          '/auth/refresh',
          { refreshToken },
          // Never let a failing refresh trigger another refresh.
          { allowRefresh: false },
        );
        if (!result?.accessToken) return null;
        await writeAccessToken(result.accessToken);
        return result.accessToken;
      } catch {
        // An expired or revoked refresh token is a real sign-out, not an
        // error to surface here: the caller still gets its 401.
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/**
 * How long a single request may hang before it is abandoned.
 *
 * React Native's `fetch` has no default timeout. Against an unroutable host
 * (the usual case: a `localhost` base URL pointing at the phone itself) the
 * socket never errors and never resolves, so the caller's spinner runs
 * forever. Every request is bounded here instead.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Resolve the backend base URL for the current platform.
 *
 * `localhost` means the device, not the development machine. On the Android
 * emulator `10.0.2.2` is the host loopback alias, so it is substituted
 * automatically — otherwise every call would hang until the timeout above.
 * A physical device is on neither loopback and needs a real LAN address in
 * `EXPO_PUBLIC_API_URL`; there is nothing to rewrite it to, so it is left
 * alone and the timeout reports it honestly.
 */
export function baseUrl(): string {
  const configured = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/u, '');
  if (__DEV__) warnAboutBaseUrl(configured);
  if (Platform.OS !== 'android') return configured;
  return configured.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/u, '$110.0.2.2');
}

/** Hosts that are genuinely reachable over cleartext during development. */
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/u;

/**
 * Flag base URLs that produce misleading failures rather than honest ones.
 *
 * Both cases below surface as an error that points at the backend when the
 * fault is in this one environment variable, so they are worth naming loudly
 * at the point of misconfiguration. Development only — this never runs in a
 * release build, and it never throws, because a wrong URL should still make
 * the request and let the real error speak.
 */
function warnAboutBaseUrl(configured: string): void {
  const match = /^(https?):\/\/([^/]*)(\/.*)?$/u.exec(configured);

  if (!match || !match[2]) {
    console.warn(
      `[api] EXPO_PUBLIC_API_URL is malformed: "${configured}". Expected an ` +
        'origin like https://api.creepy.im — check for a missing or extra slash.',
    );
    return;
  }

  const [, scheme, host, path] = match;

  /*
   * A 301 from http to https turns a POST into a GET, so the redirected call
   * lands on a POST-only route as a GET and the server answers 405. That reads
   * as "the endpoint is broken" when the only problem is the scheme.
   */
  if (scheme === 'http' && !LOCAL_HOSTS.test(host)) {
    console.warn(
      `[api] EXPO_PUBLIC_API_URL uses http:// for remote host "${host}". A ` +
        'redirect to https downgrades POST to GET, which returns 405 from ' +
        'POST-only routes. Use https://.',
    );
  }

  // The backend mounts /auth, /users and friends at the root.
  if (path && path !== '/') {
    console.warn(
      `[api] EXPO_PUBLIC_API_URL has a path suffix ("${path}"). The backend ` +
        'serves routes from the root, so this makes every request 404. Use ' +
        'the origin only.',
    );
  }
}

function apiUrl(path: string): string {
  return `${baseUrl()}${path}`;
}

export class ApiError extends Error {
  /**
   * Actionable detail the server chose to send alongside the message.
   *
   * Some failures are only useful with it: "this server could not be
   * translated" is not a problem anyone can act on, while "it imports node:fs,
   * which it cannot do inside the app sandbox" is.
   */
  readonly hints: readonly string[];

  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    hints: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.hints = hints;
  }
}

/**
 * Status 0 marks a failure that never reached the server — a timeout or a
 * transport error. Callers that branch on `status` can tell it apart from a
 * real HTTP response without parsing the message.
 */
export const NETWORK_ERROR_STATUS = 0;

type JsonObject = Record<string, unknown>;

async function request<T>(
  method: string,
  path: string,
  body?: JsonObject,
  options: { allowRefresh?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const allowRefresh = options.allowRefresh !== false;
  // Most calls are conversational and 15s is generous. A few are not: cloning
  // a repository and bundling it is minutes of work, and timing that out at
  // the default would report a failure for something still succeeding.
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = apiUrl(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    // The thrown value is not inspected: RN reports an abort and a genuine
    // transport failure with the same opaque `TypeError: Network request
    // failed`. `signal.aborted` is the only reliable way to tell them apart.
    //
    // Name the host in the message: the overwhelmingly common cause is a base
    // URL the device cannot route to, and "request failed" sends people
    // looking at the backend instead of at their `.env`.
    const aborted = controller.signal.aborted;
    throw new ApiError(
      aborted
        ? `The server at ${baseUrl()} did not respond within ${timeoutMs / 1000}s.`
        : `Could not reach the server at ${baseUrl()}.`,
      NETWORK_ERROR_STATUS,
      aborted ? 'timeout' : 'network_error',
    );
  } finally {
    clearTimeout(timer);
  }

  let json: JsonObject = {};
  try { json = await response.json() as JsonObject; } catch { /* no body */ }

  /*
   * One retry, and only when a refresh actually produced a new token. A 401
   * that survives the retry is a real authentication failure and must reach
   * the caller rather than looping.
   */
  if (response.status === 401 && allowRefresh && token) {
    const refreshed = await refreshAccessTokenOnce();
    if (refreshed) {
      return request<T>(method, path, body, { allowRefresh: false, timeoutMs });
    }
  }

  if (!response.ok) {
    const message =
      typeof json.message === 'string' && json.message
        ? json.message
        : describeHttpFailure(response.status, response.statusText, baseUrl());
    throw new ApiError(
      message,
      response.status,
      typeof json.code === 'string' ? json.code : undefined,
      Array.isArray(json.hints)
        ? json.hints.filter((hint): hint is string => typeof hint === 'string')
        : [],
    );
  }

  return json as T;
}

function get<T>(path: string) { return request<T>('GET', path); }
function post<T>(path: string, body?: JsonObject) { return request<T>('POST', path, body); }

// --- Auth ---

export type EmailPurpose = 'registration' | 'login';

export interface RequestCodeInput { email: string; name?: string; purpose: EmailPurpose; }
export interface CodeChallenge {
  challengeId: string;
  expiresInSeconds: number;
  retryAfterSeconds: number;
  /**
   * Set when the server signed this account in without a code, so there is no
   * challenge to answer and the tokens below are already valid.
   *
   * Which accounts these are is a server-side decision the app cannot see: no
   * address or rule identifying one is in the bundle. Optional, and absence
   * means "a code was sent" — an older server or a partial response must never
   * be read as an authenticated session.
   */
  autoVerified?: boolean;
  accessToken?: string | null;
  refreshToken?: string | null;
  onboardingCompleted?: boolean | null;
}
export interface VerifyCodeInput { challengeId: string; code: string; email: string; }
export interface AuthTokens { accessToken: string; refreshToken: string; onboardingCompleted?: boolean; }
export interface UserProfile { userId: string; email: string | null; name: string | null; createdAt: string; }

export async function requestEmailCode(input: RequestCodeInput): Promise<CodeChallenge> {
  return post('/auth/email/request-code', input as unknown as JsonObject);
}
export async function verifyEmailCode(input: VerifyCodeInput): Promise<AuthTokens> {
  return post('/auth/email/verify-code', input as unknown as JsonObject);
}
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
  return post('/auth/refresh', { refreshToken });
}
/** Backed by `GET /users/me`. The backend exposes no `/auth/session` route. */
export async function getUserProfile(): Promise<UserProfile> {
  return get('/users/me');
}

export interface Entitlements {
  agentAccess: boolean;
  cloudAgentAllowed: boolean;
  maxAgentMessagesPerDay: number | null;
  planCode: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  /**
   * Whether this account has to buy anything.
   *
   * The server decides; the app only reads. Which accounts are exempt, and
   * why, is deliberately not knowable from here — no address, plan code or
   * flag naming a particular user appears in the bundle, so shipping the app
   * does not ship the list.
   *
   * Optional because an older server omits it. Treat a missing value as
   * `true`: payment required is the safe reading, and a bypass must never be
   * what happens when the server said nothing.
   */
  subscriptionRequired?: boolean;
}

export interface PlayVerifyResult {
  subscription: { subscriptionId: string; status: string; currentPeriodEnd: string };
  entitlements: Entitlements;
}

/**
 * Exchange a Play purchase token for an entitlement.
 *
 * The token is proof of payment to Google, not entitlement to this app. Only
 * the backend can turn one into the other: it resolves the token against the
 * Play Developer API, so nothing the client claims here — plan, price, period
 * — is believed. Call this immediately after Play reports success; until it
 * returns, the user has paid and has nothing.
 */
export async function verifyPlayPurchase(input: {
  purchaseToken: string;
  productId?: string;
  basePlanId?: string;
}): Promise<PlayVerifyResult> {
  return post('/subscriptions/play/verify', input as unknown as JsonObject);
}

/** The caller's own subscription and entitlements. Backed by `GET /subscriptions/me`. */
export async function getMySubscription(): Promise<{
  subscription: unknown | null;
  entitlements: Entitlements;
}> {
  return get('/subscriptions/me');
}

// --- Custom MCP servers ---

export interface TranslatedEnvironmentVariable {
  name: string;
  required: boolean;
  description?: string | null;
}

export interface TranslatedMcpServer {
  bundleId: string;
  runtime: string;
  entrypoint: string | null;
  confidence: number;
  evidence: string[];
  requiredEnvironment: TranslatedEnvironmentVariable[];
  sha256: string;
  bytes: number;
  downloadUrl: string;
}

/** Cloning, installing and bundling a repository is minutes, not seconds. */
const TRANSLATE_TIMEOUT_MS = 5 * 60_000;

/**
 * Ask the backend to translate an MCP server repository for this device.
 *
 * The server itself will run *here*, in the app's own runtime — the backend is
 * a compiler, not a host. Once the bundle is downloaded the server keeps
 * working with the backend unreachable, which is what makes these local.
 */
export async function translateMcpServer(input: {
  url: string;
  ref?: string;
}): Promise<TranslatedMcpServer> {
  return request<TranslatedMcpServer>(
    'POST',
    '/mcp/translate',
    input as unknown as JsonObject,
    { timeoutMs: TRANSLATE_TIMEOUT_MS },
  );
}

/**
 * Fetch a translated bundle as text.
 *
 * Not `request`, because the response is JavaScript rather than JSON. The
 * caller verifies the SHA-256 before evaluating it: this is executable code,
 * so "probably the right bytes" is not a standard worth holding it to.
 */
export async function downloadMcpBundle(bundleId: string): Promise<string> {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(apiUrl(`/mcp/bundles/${bundleId}`), { headers });
  if (!response.ok) {
    throw new ApiError(
      describeHttpFailure(response.status, response.statusText, baseUrl()),
      response.status,
    );
  }
  return response.text();
}

// --- On-device model weights ---

export interface ModelFileEntry {
  name: string;
  role: string;
  bytes: number;
  sha256: string;
  url: string;
}

export interface ModelBundleEntry {
  profile: string;
  model: string;
  totalBytes: number;
  files: ModelFileEntry[];
  /**
   * The window this model was converted for, if the server says.
   *
   * Optional because the app must keep working against a server that does not
   * send it, and because only the backend knows which model it published — the
   * app used to carry one pair of numbers measured from the 2B teacher, which
   * would be silently wrong the moment the served model changed. See
   * `runtimeForModel`.
   */
  contextSize?: number;
  /** Reply budget for that window, if the server says. */
  maxTokens?: number;
}

export interface ModelCatalog {
  bundles: ModelBundleEntry[];
  /** False without a live subscription. The sizes are still shown. */
  downloadAllowed: boolean;
}

/**
 * What the on-device model would cost to download, and whether it may be.
 *
 * Readable before paying on purpose: the size belongs on the screen where
 * someone chooses on-device inference, which precedes the paywall.
 */
export async function getModelCatalog(): Promise<ModelCatalog> {
  return get('/models/catalog');
}

/** An absolute URL for a weight file, for a streaming download. */
export function modelFileUrl(path: string): string {
  return apiUrl(path);
}
