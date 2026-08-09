import type { Request, Response, Router } from 'express';
import express from 'express';
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import Config from '../../../config/attestation.config';
import type { DeviceRegistry } from './deviceRegistry';
import type {
  NativeLaunchConsumeRequest,
  NativeLaunchConsumeResponse,
  TelegramMiniAppAuthRequest,
  TelegramMiniAppAuthResponse,
} from '@attestation/shared/wire';

export type TelegramInitDataUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
};

export type VerifiedTelegramInitData = {
  user: TelegramInitDataUser;
  authDate: number;
  queryId?: string;
  raw: Record<string, string>;
};

export type NativeLaunchSession = {
  launchSessionId: string;
  launchToken: string;
  customUserId: string;
  telegramUserId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  consumedAtMs?: number;
};

export interface NativeLaunchStore {
  put(session: NativeLaunchSession): Promise<void>;
  consume(launchToken: string): Promise<NativeLaunchSession | undefined>;
}

export class InMemoryNativeLaunchStore implements NativeLaunchStore {
  private readonly sessions = new Map<string, NativeLaunchSession>();

  async put(session: NativeLaunchSession): Promise<void> {
    this.sessions.set(session.launchToken, session);
  }

  async consume(
    launchToken: string,
  ): Promise<NativeLaunchSession | undefined> {
    const session = this.sessions.get(launchToken);
    this.sessions.delete(launchToken);
    if (!session || session.expiresAtMs < Date.now() || session.consumedAtMs) {
      return undefined;
    }
    return { ...session, consumedAtMs: Date.now() };
  }
}

const customUserIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{2,63}$/u;

const parseInitData = (initData: string): URLSearchParams =>
  new URLSearchParams(initData.startsWith('?') ? initData.slice(1) : initData);

const hmac = (key: Buffer | string, value: string): Buffer =>
  createHmac('sha256', key).update(value).digest();

const safeHexCompare = (leftHex: string, rightHex: string): boolean => {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

export const verifyTelegramInitData = (
  initData: string,
  botToken = Config.telegram.botToken,
): VerifiedTelegramInitData => {
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_NOT_CONFIGURED');
  }

  const params = parseInitData(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) {
    throw new Error('TELEGRAM_INIT_DATA_INVALID');
  }

  const dataCheckString = Array.from(params.entries())
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = hmac('WebAppData', botToken);
  const expectedHash = hmac(secretKey, dataCheckString).toString('hex');

  if (!safeHexCompare(receivedHash, expectedHash)) {
    throw new Error('TELEGRAM_INIT_DATA_INVALID');
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) {
    throw new Error('TELEGRAM_INIT_DATA_INVALID');
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (
    ageSeconds < 0 ||
    ageSeconds > Config.telegram.initDataMaxAgeSeconds
  ) {
    throw new Error('TELEGRAM_INIT_DATA_INVALID');
  }

  const userJson = params.get('user');
  if (!userJson) {
    throw new Error('TELEGRAM_INIT_DATA_INVALID');
  }
  const user = JSON.parse(userJson) as TelegramInitDataUser;
  if (!Number.isFinite(user.id)) {
    throw new Error('TELEGRAM_INIT_DATA_INVALID');
  }

  return {
    user,
    authDate,
    ...(params.get('query_id') ? { queryId: params.get('query_id') ?? '' } : {}),
    raw: Object.fromEntries(params.entries()),
  };
};

const randomToken = (): string => randomBytes(32).toString('base64url');

const nativeLaunchUrl = (launchToken: string): string => {
  return new URL(
    `/miniapp?launchToken=${encodeURIComponent(launchToken)}`,
    Config.serverBaseUrl,
  ).toString();
};

export const createTelegramAuthRouter = (deps: {
  launchStore: NativeLaunchStore;
  deviceRegistry: DeviceRegistry;
}): Router => {
  const router = express.Router();

  router.post('/auth/telegram/init-data', async (req: Request, res: Response) => {
    const body = req.body as TelegramMiniAppAuthRequest;

    if (!customUserIdPattern.test(body.customUserId)) {
      res.status(400).json({
        ok: false,
        code: 'CUSTOM_USER_ID_INVALID',
        retryable: false,
        message:
          'customUserId must be 3-64 characters and use letters, numbers, underscore, dot, colon, or hyphen',
      } satisfies TelegramMiniAppAuthResponse);
      return;
    }

    try {
      const verified = verifyTelegramInitData(body.initData);
      const launchToken = randomToken();
      const issuedAtMs = Date.now();
      const expiresAtMs =
        issuedAtMs + Config.telegram.nativeLaunchTtlSeconds * 1000;
      await deps.launchStore.put({
        launchSessionId: randomToken(),
        launchToken,
        customUserId: body.customUserId,
        telegramUserId: String(verified.user.id),
        issuedAtMs,
        expiresAtMs,
      });

      res.json({
        ok: true,
        customUserId: body.customUserId,
        telegramUserId: String(verified.user.id),
        launchToken,
        nativeLaunchUrl: nativeLaunchUrl(launchToken),
        expiresAt: expiresAtMs,
      } satisfies TelegramMiniAppAuthResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        message === 'TELEGRAM_BOT_NOT_CONFIGURED'
          ? 'TELEGRAM_BOT_NOT_CONFIGURED'
          : 'TELEGRAM_INIT_DATA_INVALID';
      res.status(code === 'TELEGRAM_BOT_NOT_CONFIGURED' ? 503 : 401).json({
        ok: false,
        code,
        message:
          code === 'TELEGRAM_BOT_NOT_CONFIGURED'
            ? 'Telegram bot token is not configured'
            : 'Telegram Mini App initData is invalid or expired',
        retryable: code === 'TELEGRAM_BOT_NOT_CONFIGURED',
      } satisfies TelegramMiniAppAuthResponse);
    }
  });

  router.post(
    '/auth/telegram/native-launch/consume',
    async (req: Request, res: Response) => {
      const body = req.body as NativeLaunchConsumeRequest;
      const session = await deps.launchStore.consume(body.launchToken);
      if (!session) {
        res.status(401).json({
          ok: false,
          code: 'LAUNCH_TOKEN_INVALID',
          message: 'Native launch token is invalid, expired, or already used',
          retryable: true,
        } satisfies NativeLaunchConsumeResponse);
        return;
      }

      res.json({
        ok: true,
        customUserId: session.customUserId,
        telegramUserId: session.telegramUserId,
        launchSessionId: session.launchSessionId,
      } satisfies NativeLaunchConsumeResponse);
    },
  );

  return router;
};
