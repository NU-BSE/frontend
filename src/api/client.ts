/**
 * Unified API client for the Creepy.IM FastAPI backend.
 *
 * Every call reads the access token from SecureStore and attaches it
 * as a Bearer header.  The backend speaks camelCase (CamelModel), so
 * request/response keys are camelCase.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_KEY = 'creepyim.auth.access-token.v1';

async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return sessionStorage.getItem(ACCESS_TOKEN_KEY);
  }
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

function apiUrl(path: string): string {
  const base = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/u, '');
  return `${base}${path}`;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let json: Record<string, JsonValue> = {};
  try {
    json = (await response.json()) as Record<string, JsonValue>;
  } catch {
    // No JSON body
  }

  if (!response.ok) {
    const msg = typeof json.message === 'string' ? json.message : response.statusText;
    const code = typeof json.code === 'string' ? json.code : undefined;
    throw new ApiError(msg, response.status, code);
  }

  return json as unknown as T;
}

function get<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

function post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  return request<T>('POST', path, body);
}

function put<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  return request<T>('PUT', path, body);
}

function del<T>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type EmailPurpose = 'registration' | 'login';

export interface RequestCodeInput {
  email: string;
  name?: string;
  purpose: EmailPurpose;
}

export interface CodeChallenge {
  challengeId: string;
  expiresInSeconds: number;
  retryAfterSeconds: number;
}

export interface VerifyCodeInput {
  challengeId: string;
  code: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  onboardingCompleted?: boolean;
}

export interface SessionInfo {
  email: string;
  profile: UserProfile | null;
}

export async function requestEmailCode(input: RequestCodeInput): Promise<CodeChallenge> {
  return post<CodeChallenge>('/auth/email/request-code', input as unknown as Record<string, unknown>);
}

export async function verifyEmailCode(input: VerifyCodeInput): Promise<AuthTokens> {
  return post<AuthTokens>('/auth/email/verify-code', input as unknown as Record<string, unknown>);
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
  return post<{ accessToken: string }>('/auth/refresh', { refreshToken });
}

export async function getSession(): Promise<SessionInfo> {
  return get<SessionInfo>('/auth/session');
}

export async function logout(): Promise<void> {
  await post('/auth/logout');
}

// ---------------------------------------------------------------------------
// User profile & preferences
// ---------------------------------------------------------------------------

export interface UserProfile {
  userId: string;
  email: string | null;
  name: string | null;
  createdAt: string;
  preferences?: Record<string, unknown>;
}

export interface UpdateProfileInput {
  name: string;
}

export async function getUserProfile(): Promise<UserProfile> {
  return get<UserProfile>('/users/me');
}

export async function updateUserProfile(input: UpdateProfileInput): Promise<UserProfile> {
  return request<UserProfile>('PATCH', '/users/me', input as unknown as Record<string, unknown>);
}

export interface UserPreferences {
  categories?: string[];
  memoryProfile?: string;
  onboardingCompleted?: boolean;
}

export async function getUserPreferences(): Promise<UserPreferences> {
  return get<UserPreferences>('/user/preferences');
}

export async function updateUserPreferences(input: UserPreferences): Promise<UserPreferences> {
  return put<UserPreferences>('/user/preferences', input as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  entryId: string;
  threadId: string;
  category: string;
  prompt: string;
  reply: string;
  engine: string;
  createdAt: string;
}

export interface AppendHistoryInput {
  threadId: string;
  category: string;
  prompt: string;
  reply: string;
  engine: string;
}

export async function listHistory(): Promise<HistoryEntry[]> {
  return get<HistoryEntry[]>('/user/history');
}

export async function appendHistory(input: AppendHistoryInput): Promise<HistoryEntry> {
  return post<HistoryEntry>('/user/history', input as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

export interface Connector {
  id: string;
  label: string;
  type: string;
  provider: string;
  description: string;
  connected: boolean;
  connectedAt: string | null;
}

export async function listConnectors(): Promise<Connector[]> {
  return get<Connector[]>('/connectors/');
}

export async function connectConnector(connectorId: string): Promise<Connector> {
  return post<Connector>(`/connectors/${connectorId}/connect`);
}

export async function disconnectConnector(connectorId: string): Promise<void> {
  await del(`/connectors/${connectorId}`);
}

// ---------------------------------------------------------------------------
// Tools — calendar
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  connectionId: string;
  title: string;
  start: string;
  end: string;
  description?: string | null;
}

export interface ListEventsInput {
  connectionId: string;
  start: string;
  end: string;
  maxResults?: number;
}

export interface CreateEventInput {
  connectionId: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  approvalId: string;
  idempotencyKey: string;
}

export async function listCalendarEvents(input: ListEventsInput): Promise<{ events: CalendarEvent[] }> {
  return post<{ events: CalendarEvent[] }>('/tools/calendar/list-events', input as unknown as Record<string, unknown>);
}

export async function createCalendarEvent(input: CreateEventInput): Promise<{ event: CalendarEvent }> {
  return post<{ event: CalendarEvent }>('/tools/calendar/create-event', input as unknown as Record<string, unknown>);
}
