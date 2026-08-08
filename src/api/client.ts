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

function apiUrl(path: string): string {
  const base = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/u, '');
  return `${base}${path}`;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type JsonObject = Record<string, unknown>;

async function request<T>(method: string, path: string, body?: JsonObject): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

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
