import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  ApiError,
  refreshAccessToken,
  requestEmailCode as apiRequestCode,
  verifyEmailCode as apiVerifyCode,
} from '@/api/client';
import type {
  AuthTokens,
  CodeChallenge,
  EmailPurpose,
  RequestCodeInput,
  VerifyCodeInput,
} from '@/api/client';

export type { EmailPurpose };

const ACCESS_TOKEN_KEY = 'creepyim.auth.access-token.v1';
const REFRESH_TOKEN_KEY = 'creepyim.auth.refresh-token.v1';
const EMAIL_KEY = 'creepyim.auth.email.v1';

const readValue = async (key: string): Promise<string | null> => {
  if (Platform.OS === 'web') return sessionStorage.getItem(key);
  return SecureStore.getItemAsync(key);
};
const writeValue = async (key: string, value: string): Promise<void> => {
  if (Platform.OS === 'web') { sessionStorage.setItem(key, value); return; }
  await SecureStore.setItemAsync(key, value);
};
const deleteValue = async (key: string): Promise<void> => {
  if (Platform.OS === 'web') { sessionStorage.removeItem(key); return; }
  await SecureStore.deleteItemAsync(key);
};

export class EmailAuthError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'EmailAuthError';
  }
}

/**
 * Ask for a verification code.
 *
 * The server may answer that this account is already signed in — some accounts
 * do not receive codes at all — in which case the session it returned is
 * persisted here and the caller skips the code screen. Which accounts those
 * are is a server-side decision this app cannot see or reproduce.
 *
 * The session is only taken when `autoVerified` is true AND an access token is
 * actually present. Either alone is not a session, and treating a partial
 * response as one would sign the user in against nothing.
 */
export async function requestEmailCode(input: RequestCodeInput): Promise<CodeChallenge> {
  try {
    const challenge = await apiRequestCode(input);
    if (challenge.autoVerified && challenge.accessToken) {
      await persistSession({
        accessToken: challenge.accessToken,
        refreshToken: challenge.refreshToken ?? undefined,
        email: input.email,
      });
    }
    return challenge;
  }
  catch (e) {
    if (e instanceof ApiError) throw new EmailAuthError(e.message, e.status);
    throw new EmailAuthError('Could not send the verification code.');
  }
}

async function persistSession(input: {
  accessToken: string;
  refreshToken?: string;
  email: string;
}): Promise<void> {
  await writeValue(ACCESS_TOKEN_KEY, input.accessToken);
  await writeValue(EMAIL_KEY, input.email);
  if (input.refreshToken) await writeValue(REFRESH_TOKEN_KEY, input.refreshToken);
}

export interface VerifiedEmailSession { email: string; onboardingCompleted?: boolean; }

export async function verifyEmailCode(input: VerifyCodeInput): Promise<VerifiedEmailSession> {
  try {
    const tokens: AuthTokens = await apiVerifyCode(input);
    await persistSession({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      email: input.email,
    });
    return { email: input.email, onboardingCompleted: tokens.onboardingCompleted };
  } catch (e) {
    if (e instanceof ApiError) throw new EmailAuthError(e.message, e.status);
    throw new EmailAuthError('The verification code is invalid or expired.');
  }
}

export async function tryRefreshToken(): Promise<boolean> {
  try {
    const rt = await readValue(REFRESH_TOKEN_KEY);
    if (!rt) return false;
    const result = await refreshAccessToken(rt);
    await writeValue(ACCESS_TOKEN_KEY, result.accessToken);
    return true;
  } catch { return false; }
}

export async function hasAuthSession(): Promise<boolean> {
  try { return Boolean(await readValue(ACCESS_TOKEN_KEY)); }
  catch { return false; }
}

export async function getAuthenticatedEmail(): Promise<string | null> {
  try { return await readValue(EMAIL_KEY); }
  catch { return null; }
}

export async function clearAuthSession(): Promise<void> {
  await Promise.all([deleteValue(ACCESS_TOKEN_KEY), deleteValue(REFRESH_TOKEN_KEY), deleteValue(EMAIL_KEY)]);
}
