import * as SecureStore from "expo-secure-store";

const ACCESS_TOKEN_KEY = "creepyim.auth.access-token.v1";
const REFRESH_TOKEN_KEY = "creepyim.auth.refresh-token.v1";
const EMAIL_KEY = "creepyim.auth.email.v1";

export type EmailAuthPurpose = "registration" | "login";

export type RequestEmailCodeInput = {
  email: string;
  name?: string;
  purpose: EmailAuthPurpose;
};

export type EmailCodeChallenge = {
  challengeId: string;
  expiresInSeconds?: number;
  retryAfterSeconds?: number;
};

export type VerifyEmailCodeInput = {
  challengeId: string;
  code: string;
  email: string;
};

export type VerifiedEmailSession = {
  email: string;
  onboardingCompleted?: boolean;
};

type JsonObject = Record<string, unknown>;

export class EmailAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EmailAuthError";
  }
}

const getApiUrl = (path: string): string => {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/u, "");
  if (!baseUrl) {
    throw new EmailAuthError(
      "Email sign-in is not configured. Set EXPO_PUBLIC_API_URL.",
    );
  }
  return `${baseUrl}${path}`;
};

const parseJson = async (response: Response): Promise<JsonObject> => {
  try {
    return (await response.json()) as JsonObject;
  } catch {
    return {};
  }
};

const getErrorMessage = (body: JsonObject, fallback: string): string => {
  const detail = body.detail;
  if (typeof detail === "string" && detail.length > 0) return detail;
  const message = body.message;
  return typeof message === "string" && message.length > 0 ? message : fallback;
};

export async function requestEmailCode(
  input: RequestEmailCodeInput,
): Promise<EmailCodeChallenge> {
  const response = await fetch(getApiUrl("/auth/email/request-code"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await parseJson(response);
  if (!response.ok) {
    throw new EmailAuthError(
      getErrorMessage(body, "Could not send the verification code."),
      response.status,
    );
  }

  const challengeId = body.challengeId ?? body.challenge_id;
  if (typeof challengeId !== "string" || challengeId.length === 0) {
    throw new EmailAuthError("The server did not return a code challenge.");
  }

  const expiresInSeconds = body.expiresInSeconds ?? body.expires_in_seconds;
  const retryAfterSeconds = body.retryAfterSeconds ?? body.retry_after_seconds;
  return {
    challengeId,
    expiresInSeconds:
      typeof expiresInSeconds === "number" ? expiresInSeconds : undefined,
    retryAfterSeconds:
      typeof retryAfterSeconds === "number" ? retryAfterSeconds : undefined,
  };
}

export async function verifyEmailCode(
  input: VerifyEmailCodeInput,
): Promise<VerifiedEmailSession> {
  const response = await fetch(getApiUrl("/auth/email/verify-code"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await parseJson(response);
  if (!response.ok) {
    throw new EmailAuthError(
      getErrorMessage(body, "The verification code is invalid or expired."),
      response.status,
    );
  }

  const accessToken = body.accessToken ?? body.access_token;
  const refreshToken = body.refreshToken ?? body.refresh_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new EmailAuthError("The server did not return an access token.");
  }

  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
  await SecureStore.setItemAsync(EMAIL_KEY, input.email);
  if (typeof refreshToken === "string" && refreshToken.length > 0) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
  }

  const onboardingCompleted =
    body.onboardingCompleted ?? body.onboarding_completed;
  return {
    email: input.email,
    onboardingCompleted:
      typeof onboardingCompleted === "boolean"
        ? onboardingCompleted
        : undefined,
  };
}

export async function hasAuthSession(): Promise<boolean> {
  try {
    return Boolean(await SecureStore.getItemAsync(ACCESS_TOKEN_KEY));
  } catch {
    return false;
  }
}

export async function getAuthenticatedEmail(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(EMAIL_KEY);
  } catch {
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(EMAIL_KEY),
  ]);
}
