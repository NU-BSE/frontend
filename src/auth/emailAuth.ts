/**
 * Email auth — uses the unified API client to talk to the FastAPI backend.
 *
 * Tokens are stored in expo-secure-store (native) or sessionStorage (web).
 */
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
  if (Platform.OS === 'web') {
    return sessionStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
};

const writeValue = async (key: string, value: string): Promise<void> => {
  if (Platform.OS === 'web') {
    sessionStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
};

const deleteValue = async (key: string): Promise<void> => {
  if (Platform.OS === 'web') {
    sessionStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
};

export class EmailAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EmailAuthError';
  }
}

export async function requestEmailCode(input: RequestCodeInput): Promise<CodeChallenge> {
  try {
    return await apiRequestCode(input);
  } catch (error) {
    if (error instanceof ApiError) {
      throw new EmailAuthError(error.message, error.status);
    }
    throw new EmailAuthError('Could not send the verification code.');
  }
}

export interface VerifiedEmailSession {
  email: string;
  onboardingCompleted?: boolean;
}

export async function verifyEmailCode(input: VerifyCodeInput): Promise<VerifiedEmailSession> {
  try {
    const tokens: AuthTokens = await apiVerifyCode(input);

    await writeValue(ACCESS_TOKEN_KEY, tokens.accessToken);
    await writeValue(EMAIL_KEY, input.email);
    if (tokens.refreshToken) {
      await writeValue(REFRESH_TOKEN_KEY, tokens.refreshToken);
    }

    return {
      email: input.email,
      onboardingCompleted: tokens.onboardingCompleted,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw new EmailAuthError(error.message, error.status);
    }
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
  } catch {
    return false;
  }
}

export async function hasAuthSession(): Promise<boolean> {
  try {
    const token = await readValue(ACCESS_TOKEN_KEY);
    return Boolean(token);
  } catch {
    return false;
  }
}

export async function getAuthenticatedEmail(): Promise<string | null> {
  try {
    return await readValue(EMAIL_KEY);
  } catch {
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  await Promise.all([
    deleteValue(ACCESS_TOKEN_KEY),
    deleteValue(REFRESH_TOKEN_KEY),
    deleteValue(EMAIL_KEY),
  ]);
}
