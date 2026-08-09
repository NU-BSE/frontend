/**
 * API client for the Creepy.IM FastAPI backend.
 * Only auth-related endpoints — everything else is local.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS_TOKEN_KEY = 'creepyim.auth.access-token.v1';

async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') return sessionStorage.getItem(ACCESS_TOKEN_KEY);
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
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
function baseUrl(): string {
  const configured = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/u, '');
  if (Platform.OS !== 'android') return configured;
  return configured.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/u, '$110.0.2.2');
}

function apiUrl(path: string): string {
  return `${baseUrl()}${path}`;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Status 0 marks a failure that never reached the server — a timeout or a
 * transport error. Callers that branch on `status` can tell it apart from a
 * real HTTP response without parsing the message.
 */
export const NETWORK_ERROR_STATUS = 0;

type JsonObject = Record<string, unknown>;

async function request<T>(method: string, path: string, body?: JsonObject): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = apiUrl(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
        ? `The server at ${baseUrl()} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`
        : `Could not reach the server at ${baseUrl()}.`,
      NETWORK_ERROR_STATUS,
      aborted ? 'timeout' : 'network_error',
    );
  } finally {
    clearTimeout(timer);
  }

  let json: JsonObject = {};
  try { json = await response.json() as JsonObject; } catch { /* no body */ }

  if (!response.ok) {
    const msg = typeof json.message === 'string' ? json.message : response.statusText;
    throw new ApiError(msg, response.status, typeof json.code === 'string' ? json.code : undefined);
  }

  return json as T;
}

function get<T>(path: string) { return request<T>('GET', path); }
function post<T>(path: string, body?: JsonObject) { return request<T>('POST', path, body); }

// --- Auth ---

export type EmailPurpose = 'registration' | 'login';

export interface RequestCodeInput { email: string; name?: string; purpose: EmailPurpose; }
export interface CodeChallenge { challengeId: string; expiresInSeconds: number; retryAfterSeconds: number; }
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
export async function getSession(): Promise<{ email: string; profile: UserProfile | null }> {
  return get('/auth/session');
}
export async function getUserProfile(): Promise<UserProfile> {
  return get('/users/me');
}
