import { Linking } from 'react-native';
import { serverBaseUrl, telegramBotUsername } from './runtimeConfig';
import { setCustomUserId, userHeaders } from './userSession';
import type {
  GetAttestationResultResponse,
  NativeLaunchConsumeResponse,
  StockSellingDeviceDraft,
  SubmitAttestationResultRequest,
  SubmitAttestationResultResponse,
  TelegramMiniAppAuthResponse,
} from '@attestation/shared/wire';

type TelegramWindow = {
  Telegram?: {
    WebApp?: {
      initData?: string;
      openLink?: (url: string) => void;
      ready?: () => void;
    };
  };
};

export const getTelegramMiniAppInitData = (): string => {
  const initData = (globalThis as unknown as { window?: TelegramWindow }).window
    ?.Telegram?.WebApp?.initData;
  if (!initData) {
    throw new Error('Telegram Mini App initData is unavailable');
  }
  return initData;
};

export const authenticateTelegramMiniAppLaunch = async (input: {
  customUserId: string;
  initData?: string;
  deviceSubmission?: StockSellingDeviceDraft;
}): Promise<Extract<TelegramMiniAppAuthResponse, { ok: true }>> => {
  const response = await fetch(`${serverBaseUrl}/auth/telegram/init-data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...userHeaders() },
    body: JSON.stringify({
      initData: input.initData ?? getTelegramMiniAppInitData(),
      customUserId: input.customUserId,
      requestedPlatform: 'android',
      ...(input.deviceSubmission
        ? { deviceSubmission: input.deviceSubmission }
        : {}),
    }),
  });
  const json = (await response.json()) as TelegramMiniAppAuthResponse;
  if (!json.ok) {
    throw new Error(json.message);
  }
  setCustomUserId(json.customUserId);
  return json;
};

export const launchAndroidNativeAppFromTelegram = async (input: {
  customUserId: string;
  initData?: string;
  deviceSubmission?: StockSellingDeviceDraft;
}): Promise<void> => {
  const launch = await authenticateTelegramMiniAppLaunch(input);
  const webApp = (globalThis as unknown as { window?: TelegramWindow }).window
    ?.Telegram?.WebApp;
  if (/^https?:\/\//u.test(launch.nativeLaunchUrl) && webApp?.openLink) {
    webApp.openLink(launch.nativeLaunchUrl);
    return;
  }
  await Linking.openURL(launch.nativeLaunchUrl);
};

export const extractLaunchTokenFromUrl = (
  url: string | null | undefined,
): string | undefined => {
  if (!url) return undefined;
  const match = /[?&]launchToken=([^&#]+)/u.exec(url);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
};

export const consumeNativeLaunchToken = async (
  launchToken: string,
): Promise<Extract<NativeLaunchConsumeResponse, { ok: true }>> => {
  const response = await fetch(
    `${serverBaseUrl}/auth/telegram/native-launch/consume`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ launchToken }),
    },
  );
  const json = (await response.json()) as NativeLaunchConsumeResponse;
  if (!json.ok) {
    throw new Error(json.message);
  }
  setCustomUserId(json.customUserId);
  return json;
};

export const consumeInitialNativeLaunch = async (): Promise<
  Extract<NativeLaunchConsumeResponse, { ok: true }> | undefined
> => {
  const url = await Linking.getInitialURL();
  const launchToken = extractLaunchTokenFromUrl(url);
  return launchToken ? consumeNativeLaunchToken(launchToken) : undefined;
};

/**
 * Persists the outcome of a native attestation so the Telegram Mini App can
 * fetch it after the user returns. Keyed by `ref` (the launch session id).
 */
export const submitAttestationResult = async (
  input: SubmitAttestationResultRequest,
): Promise<void> => {
  const response = await fetch(`${serverBaseUrl}/attest/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...userHeaders() },
    body: JSON.stringify(input),
  });
  const json = (await response.json()) as SubmitAttestationResultResponse;
  if (!json.ok) {
    throw new Error(json.message);
  }
};

export const fetchAttestationResult = async (
  ref: string,
): Promise<Extract<GetAttestationResultResponse, { ok: true }>['result']> => {
  const response = await fetch(
    `${serverBaseUrl}/attest/result/${encodeURIComponent(ref)}`,
  );
  const json = (await response.json()) as GetAttestationResultResponse;
  if (!json.ok) {
    throw new Error(json.message);
  }
  return json.result;
};

/**
 * Builds a Telegram deep link that reopens the Mini App carrying `ref` as the
 * `start_param`. Returns undefined when no bot username is configured.
 */
export const buildTelegramReturnUrl = (ref: string): string | undefined => {
  if (!telegramBotUsername) {
    return undefined;
  }
  return `https://t.me/${telegramBotUsername}?startapp=${encodeURIComponent(ref)}`;
};

/** Opens Telegram (via the bot deep link) to hand the user back to the Mini App. */
export const returnToTelegram = async (ref: string): Promise<boolean> => {
  const url = buildTelegramReturnUrl(ref);
  if (!url) {
    return false;
  }
  await Linking.openURL(url);
  return true;
};
