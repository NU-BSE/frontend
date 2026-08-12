import { ConnectorError } from '@mobile-agent/connector-core';
import {
  TdlibUnavailableError,
  type TdChat,
  type TdlibAdapter,
  type TdlibAuthState,
  type TdlibAuthStateListener,
  type TdMessage,
  type TdSentMessage,
} from './types';
import { mapAuthorizationState, mapTdUser, parsePhoneNumber, validatePhoneNumber } from './auth-state-mapper';
import { normalizeChat, normalizeMessage, normalizeSentMessage } from './normalizers';
import { mapTdlibError } from './tdlib-error-mapper';

type ReactNativeTdLib = typeof import('react-native-tdlib').default;

const LOG_PREFIX = '[TDLIB]';

function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${LOG_PREFIX} ${context}:`, message, error);
}

interface TelegramConfig {
  apiId: number;
  apiHash: string;
  systemLanguageCode?: string;
  applicationVersion?: string;
}

function loadTdLib(): ReactNativeTdLib {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('react-native-tdlib');
    return (module.default ?? module) as ReactNativeTdLib;
  } catch (error) {
    logError('loadTdLib: module not available', error);
    throw new TdlibUnavailableError(
      'react-native-tdlib is not available in this native build.',
    );
  }
}

function loadTelegramConfig(): TelegramConfig {
  const apiIdRaw = process.env.EXPO_PUBLIC_TELEGRAM_API_ID;
  const apiHash = process.env.EXPO_PUBLIC_TELEGRAM_API_HASH;

  if (!apiIdRaw || !apiHash) {
    throw new TdlibUnavailableError(
      'Telegram API credentials are not configured. Set EXPO_PUBLIC_TELEGRAM_API_ID ' +
        'and EXPO_PUBLIC_TELEGRAM_API_HASH in your environment.',
    );
  }

  const apiId = parseInt(apiIdRaw, 10);
  if (Number.isNaN(apiId) || apiId <= 0) {
    throw new TdlibUnavailableError(
      'EXPO_PUBLIC_TELEGRAM_API_ID must be a positive integer.',
    );
  }

  return {
    apiId,
    apiHash,
    systemLanguageCode: 'en',
    applicationVersion: '0.1.0',
  };
}

export class NativeTdlibAdapter implements TdlibAdapter {
  readonly kind = 'native' as const;

  private tdlib: ReactNativeTdLib | null = null;
  private config: TelegramConfig | null = null;

  private state: TdlibAuthState = { type: 'not_initialized' };
  private listener: TdlibAuthStateListener | null = null;
  private emitterSubscription: { remove: () => void } | null = null;

  private readonly pendingSends = new Map<string, PendingSend>();
  private readonly earlySendResults = new Map<string, EarlySendResult>();
  private authStateChangeResolver: (() => void) | null = null;
  private static readonly SEND_TIMEOUT_MS = 30_000;
  private static readonly AUTH_REQUEST_TIMEOUT_MS = 15_000;

  async initialize(): Promise<void> {
    if (this.tdlib) return;

    const tdlib = loadTdLib();
    const config = loadTelegramConfig();

    this.tdlib = tdlib;
    this.config = config;

    this.transition({ type: 'initializing' });

    this.subscribeToUpdates(tdlib);

    try {
      await tdlib.startTdLib({
        api_id: config.apiId,
        api_hash: config.apiHash,
        system_language_code: config.systemLanguageCode,
        application_version: config.applicationVersion,
      });
    } catch (error) {
      logError('initialize: startTdLib failed', error);
      if (this.emitterSubscription) {
        this.emitterSubscription.remove();
        this.emitterSubscription = null;
      }
      this.tdlib = null;
      this.config = null;
      this.transition({
        type: 'error',
        message: 'Failed to initialize Telegram.',
      });
      throw mapTdlibError(error, 'initialization');
    }

    await this.reconcileAuthorizationState(tdlib);
  }

  getAuthState(): TdlibAuthState {
    return this.state;
  }

  setAuthStateListener(listener: TdlibAuthStateListener): () => void {
    this.listener = listener;
    listener(this.state);
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  // ------------------------------------------------------------------
  // Auth methods
  // ------------------------------------------------------------------

  async requestPhoneNumber(phoneNumber: string): Promise<void> {
    this.assertAuthState('wait_phone_number');
    const tdlib = this.assertModule();
    const cleaned = validatePhoneNumber(phoneNumber);
    const { countrycode, phoneNumber: localNumber } = parsePhoneNumber(cleaned);

    try {
      await tdlib.login({ countrycode, phoneNumber: localNumber });
    } catch (error) {
      logError('requestPhoneNumber: login failed', error);
      throw mapTdlibError(error, 'phone number submission');
    }
  }

  async submitAuthCode(code: string): Promise<void> {
    this.assertAuthState('wait_code');
    const tdlib = this.assertModule();
    try {
      await tdlib.verifyPhoneNumber(code);
    } catch (error) {
      logError('submitAuthCode: verifyPhoneNumber failed', error);
      throw mapTdlibError(error, 'code verification');
    }
  }

  async submitPassword(password: string): Promise<void> {
    this.assertAuthState('wait_password');
    const tdlib = this.assertModule();
    try {
      await tdlib.verifyPassword(password);
    } catch (error) {
      logError('submitPassword: verifyPassword failed', error);
      throw mapTdlibError(error, 'password verification');
    }
  }

  async submitEmailAddress(email: string): Promise<void> {
    this.assertAuthState('wait_email_address');
    const tdlib = this.assertModule();
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@') || normalized.length < 5 || normalized.length > 254) {
      throw new ConnectorError('Invalid email address.', 'VALIDATION_FAILED');
    }

    try {
      await this.sendAuthRequest(tdlib, {
        ['@type']: 'setAuthenticationEmailAddress',
        email_address: normalized,
      });
    } catch (error) {
      logError('submitEmailAddress: sendAuthRequest failed', error);
      throw mapTdlibError(error, 'email submission');
    }
  }

  async submitEmailCode(code: string): Promise<void> {
    this.assertAuthState('wait_email_code');
    const tdlib = this.assertModule();
    try {
      await this.sendAuthRequest(tdlib, {
        ['@type']: 'checkAuthenticationEmailCode',
        code: {
          ['@type']: 'emailAddressAuthenticationCode',
          code,
        },
      });
    } catch (error) {
      logError('submitEmailCode: sendAuthRequest failed', error);
      throw mapTdlibError(error, 'email code verification');
    }
  }

  async submitRegistration(firstName: string, lastName: string): Promise<void> {
    this.assertAuthState('wait_registration');
    const tdlib = this.assertModule();
    const first = firstName.trim();
    const last = lastName.trim();

    if (first.length < 1 || first.length > 64) {
      throw new ConnectorError('First name must be 1–64 characters.', 'VALIDATION_FAILED');
    }
    if (last.length > 64) {
      throw new ConnectorError('Last name must be at most 64 characters.', 'VALIDATION_FAILED');
    }

    try {
      await this.sendAuthRequest(tdlib, {
        ['@type']: 'registerUser',
        first_name: first,
        last_name: last,
        disable_notification: false,
      });
    } catch (error) {
      logError('submitRegistration: sendAuthRequest failed', error);
      throw mapTdlibError(error, 'registration');
    }
  }

  // ------------------------------------------------------------------
  // Tool methods
  // ------------------------------------------------------------------

  async searchChats(query: string, limit = 10): Promise<TdChat[]> {
    const tdlib = this.assertModule();
    try {
      const raw = await tdlib.searchChats(query, Math.min(limit, 20));
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .slice(0, limit)
        .map((chat) => normalizeChat(chat as Record<string, unknown>));
    } catch (error) {
      logError('searchChats: searchChats failed', error);
      throw mapTdlibError(error, 'search');
    }
  }

  async getRecentMessages(chatId: string, limit = 20): Promise<TdMessage[]> {
    const tdlib = this.assertModule();
    try {
      const items = await tdlib.getChatHistory(Number(chatId), 0, Math.min(limit, 50), 0);
      if (!Array.isArray(items)) return [];
      return items
        .map((item) => {
          try { return JSON.parse(item.raw_json) as Record<string, unknown>; }
          catch { return null; }
        })
        .filter((raw): raw is Record<string, unknown> => raw != null)
        .map(normalizeMessage);
    } catch (error) {
      logError('getRecentMessages: getChatHistory failed', error);
      throw mapTdlibError(error, 'reading messages');
    }
  }

  async sendMessage(chatId: string, text: string): Promise<TdSentMessage> {
    const tdlib = this.assertModule();
    let result: TdRawResultLike;
    try {
      result = await tdlib.sendMessage(Number(chatId), text);
    } catch (error) {
      logError('sendMessage: sendMessage call failed', error);
      throw mapTdlibError(error, 'sending message');
    }

    const raw = parseResultRaw(result);
    assertNotTdlibError(raw);

    const tempId = raw.id;
    if (!isValidMessageId(tempId)) {
      logError('sendMessage: no message id', { raw });
      throw new Error('Telegram did not confirm the message (no message id).');
    }

    const sendingState = sendingStateType(raw);

    // `messageSendingStateFailed` means the message was NOT sent.
    if (sendingState === 'messageSendingStateFailed') {
      const stateObj = raw.sending_state as Record<string, unknown> | undefined;
      const err = stateObj?.error as Record<string, unknown> | undefined;
      logError('sendMessage: sendingStateFailed', err ?? 'unknown');
      throw mapTdlibError(
        new Error(
          typeof err?.message === 'string'
            ? err.message
            : 'Telegram failed to send the message.',
        ),
        'sending message',
      );
    }

    // No sending state = already final/confirmed.
    if (!sendingState) {
      return normalizeSentMessage(chatId, text, raw);
    }

    // `messageSendingStatePending` — wait for confirmation event or timeout.

    // Check for early-arrival event first.
    const tempKey = String(tempId);
    const early = this.earlySendResults.get(tempKey);
    if (early) {
      this.earlySendResults.delete(tempKey);
      if (early.type === 'succeeded' && early.message) {
        return normalizeSentMessage(chatId, text, early.message);
      }
      throw mapTdlibError(
        new Error(
          typeof early.error === 'string'
            ? early.error
            : 'Telegram failed to send the message.',
        ),
        'sending message',
      );
    }

    return new Promise<TdSentMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSends.delete(tempKey);
        logError('sendMessage: confirmation timeout', { tempKey });
        reject(
          mapTdlibError(
            new Error('Telegram did not confirm the message within the timeout.'),
            'sending message',
          ),
        );
      }, NativeTdlibAdapter.SEND_TIMEOUT_MS);

      this.pendingSends.set(tempKey, {
        chatId,
        text,
        resolve,
        reject,
        timer,
      });
    });
  }

  async logOut(): Promise<void> {
    const tdlib = this.assertModule();
    try {
      await tdlib.logout();
    } catch (error) {
      logError('logOut: logout failed', error);
      throw mapTdlibError(error, 'logout');
    }
  }

  async close(): Promise<void> {
    for (const [, pending] of this.pendingSends) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Adapter was closed while a send was pending.'));
    }
    this.pendingSends.clear();
    this.earlySendResults.clear();

    if (this.emitterSubscription) {
      this.emitterSubscription.remove();
      this.emitterSubscription = null;
    }
    if (this.authStateChangeResolver) {
      this.authStateChangeResolver = null;
    }
    this.listener = null;
    this.tdlib = null;
    this.config = null;
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private assertModule(): ReactNativeTdLib {
    if (!this.tdlib) {
      throw new TdlibUnavailableError('NativeTdlibAdapter is not initialized');
    }
    return this.tdlib;
  }

  private assertAuthState(expected: TdlibAuthState['type']): void {
    if (this.state.type !== expected) {
      logError('assertAuthState: state mismatch', {
        expected,
        actual: this.state.type,
      });
      throw new ConnectorError(
        `Telegram authorization state changed. Expected ${expected}, got ${this.state.type}.`,
        'VALIDATION_FAILED',
      );
    }
  }

  private async sendAuthRequest(
    tdlib: ReactNativeTdLib,
    request: Record<string, unknown>,
  ): Promise<void> {
    const changePromise = this.waitForAuthStateChange(
      NativeTdlibAdapter.AUTH_REQUEST_TIMEOUT_MS,
    );
    await tdlib.td_json_client_send(request);
    await changePromise;
  }

  private waitForAuthStateChange(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.authStateChangeResolver = null;
        logError('waitForAuthStateChange: timeout', { timeoutMs });
        reject(new Error('Telegram did not respond to the authorization request.'));
      }, timeoutMs);
      this.authStateChangeResolver = () => {
        clearTimeout(timer);
        this.authStateChangeResolver = null;
        resolve();
      };
    });
  }

  private async reconcileAuthorizationState(
    tdlib: ReactNativeTdLib,
  ): Promise<void> {
    try {
        const raw = await tdlib.getAuthorizationState();
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        await this.handleAuthorizationState(tdlib, parsed);
      } catch (error) {
        logError('reconcileAuthorizationState: failed', error);
        this.transition({
        type: 'error',
        message: 'Failed to reconcile Telegram authorization state.',
      });
    }
  }

  private async handleAuthorizationState(
    tdlib: ReactNativeTdLib,
    rawState: Record<string, unknown>,
  ): Promise<void> {
    if (isTdlibReadyState(rawState)) {
      await this.resolveReadyUser(tdlib);
      return;
    }

    const next = mapAuthorizationState(rawState);
    this.transition(next);
  }

  private async resolveReadyUser(
    tdlib: ReactNativeTdLib,
  ): Promise<void> {
    try {
      const profileRaw = await tdlib.getProfile();
      const profile = JSON.parse(profileRaw) as Record<string, unknown>;
      const user = mapTdUser(profile);

      if (!user.id) {
        logError('resolveReadyUser: no user id in profile', profile);
        this.transition({
          type: 'error',
          message: 'Telegram profile did not return a valid user id.',
        });
        return;
      }

      this.transition({ type: 'ready', user });
    } catch (error) {
      logError('resolveReadyUser: getProfile/mapUser failed', error);
      this.transition({
        type: 'error',
        message: 'Failed to load Telegram profile. Please try reconnecting.',
      });
    }
  }

  private subscribeToUpdates(tdlib: ReactNativeTdLib): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { NativeEventEmitter, NativeModules } = require('react-native');
      const emitter = new NativeEventEmitter(NativeModules.TdLibModule);

      this.emitterSubscription = emitter.addListener(
        'tdlib-update',
        (event: { type: string; raw: string }) => {
          this.handleTdlibUpdate(tdlib, event);
        },
      );
    } catch {
      // NativeEventEmitter unavailable (Node test).
    }
  }

  private async handleTdlibUpdate(
    tdlib: ReactNativeTdLib,
    event: { type: string; raw: string },
  ): Promise<void> {
    switch (event.type) {
      case 'updateAuthorizationState': {
        let update: Record<string, unknown>;
        try {
          update = JSON.parse(event.raw) as Record<string, unknown>;
        } catch {
          return;
        }
        const authState =
          update.authorization_state as Record<string, unknown> | undefined;
        if (authState) {
          await this.handleAuthorizationState(tdlib, authState);
        }
        this.authStateChangeResolver?.();
        break;
      }

      case 'updateMessageSendSucceeded': {
        let update: Record<string, unknown>;
        try { update = JSON.parse(event.raw) as Record<string, unknown>; }
        catch { return; }
        this.handleSendSucceeded(update);
        break;
      }

      case 'updateMessageSendFailed': {
        let update: Record<string, unknown>;
        try { update = JSON.parse(event.raw) as Record<string, unknown>; }
        catch { return; }
        this.handleSendFailed(update);
        break;
      }
    }
  }

  private handleSendSucceeded(update: Record<string, unknown>): void {
    const oldId = String(update.old_message_id ?? '');
    const message = update.message as Record<string, unknown> | undefined;

    if (!message || !isValidMessageId(message.id)) {
      logError('handleSendSucceeded: malformed update', update);
      const pending = this.pendingSends.get(oldId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingSends.delete(oldId);
        pending.reject(
          new ConnectorError('Telegram confirmation did not contain a valid message.', 'PROVIDER_ERROR'),
        );
      }
      return;
    }

    const pending = this.pendingSends.get(oldId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingSends.delete(oldId);
      pending.resolve(
        normalizeSentMessage(pending.chatId, pending.text, message),
      );
      return;
    }

    // Early arrival: store for the pending send promise.
    this.earlySendResults.set(oldId, {
      type: 'succeeded',
      message: message as Record<string, unknown>,
      createdAt: Date.now(),
    });
    this.cleanupStaleEarlyResults();
  }

  private handleSendFailed(update: Record<string, unknown>): void {
    const oldId = String(update.old_message_id ?? '');
    const error = update.error as Record<string, unknown> | undefined;
    const errorMsg =
      typeof error?.message === 'string'
        ? error.message
        : 'Telegram failed to send the message.';

    logError('handleSendFailed', { oldId, errorMsg, update });

    const pending = this.pendingSends.get(oldId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingSends.delete(oldId);
      pending.reject(mapTdlibError(new Error(errorMsg), 'sending message'));
      return;
    }

    // Early arrival.
    this.earlySendResults.set(oldId, {
      type: 'failed',
      error: errorMsg,
      createdAt: Date.now(),
    });
    this.cleanupStaleEarlyResults();
  }

  private cleanupStaleEarlyResults(): void {
    const now = Date.now();
    const maxAge = 60_000; // 60 seconds
    for (const [key, value] of this.earlySendResults) {
      if (now - value.createdAt > maxAge) {
        this.earlySendResults.delete(key);
      }
    }
    // Also keep the map bounded.
    if (this.earlySendResults.size > 20) {
      const firstKey = this.earlySendResults.keys().next().value as string | undefined;
      if (firstKey) this.earlySendResults.delete(firstKey);
    }
  }

  private transition(next: TdlibAuthState): void {
    this.state = next;
    this.listener?.(next);
  }
}

// ------------------------------------------------------------------
// Module-level helpers
// ------------------------------------------------------------------

function isTdlibReadyState(raw: Record<string, unknown>): boolean {
  const type = raw['@type'] ?? (raw as Record<string, unknown>)['_'] ?? '';
  return String(type).replace(/^authorizationState/, '') === 'Ready';
}

function assertNotTdlibError(raw: Record<string, unknown>): void {
  const type = raw['@type'] ?? raw['_'] ?? '';
  if (type === 'error') {
    const code = raw.code ?? '';
    const message =
      typeof raw.message === 'string' ? raw.message : 'TDLib returned an error.';
    throw new Error(`TDLib error ${String(code)}: ${message}`);
  }
}

interface PendingSend {
  chatId: string;
  text: string;
  resolve: (message: TdSentMessage) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface EarlySendResult {
  type: 'succeeded' | 'failed';
  message?: Record<string, unknown>;
  error?: string;
  createdAt: number;
}

interface TdRawResultLike {
  raw?: string;
}

function parseResultRaw(result: TdRawResultLike): Record<string, unknown> {
  return typeof result.raw === 'string'
    ? (JSON.parse(result.raw) as Record<string, unknown>)
    : (result as unknown as Record<string, unknown>);
}

function sendingStateType(raw: Record<string, unknown>): string | undefined {
  const state = raw.sending_state as Record<string, unknown> | undefined;
  return state?.['@type'] as string | undefined;
}

function isValidMessageId(value: unknown): value is string | number {
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  if (typeof value === 'string' && value.length > 0) return true;
  return false;
}
