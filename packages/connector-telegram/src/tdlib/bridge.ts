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
  /*
   * Check for the native module BEFORE requiring the package.
   *
   * Its JavaScript is in node_modules on every install, while the native half
   * is only present if the build linked it — and it is not:
   * expo-modules-autolinking omits react-native-tdlib, so `TdLibModule` never
   * reaches the PackageList that Gradle generates.
   *
   * Order matters. Requiring first means the package throws its own "not
   * linked" error during module evaluation, which lands as an uncaught red
   * screen and a console.error in the dev overlay before anything here can
   * translate it. Asking React Native whether the module exists costs nothing
   * and turns a crash into the error the caller already handles.
   */
  let hasNativeModule = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require('react-native') as typeof import('react-native');
    hasNativeModule = Boolean(NativeModules?.TdLibModule);
  } catch {
    // No react-native at all: a Node verification script. Same conclusion.
    hasNativeModule = false;
  }
  if (!hasNativeModule) {
    throw new TdlibUnavailableError(
      'Telegram is unavailable: this build does not include the TDLib native module.',
    );
  }

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
  private pendingTdRequest: PendingTdRequest | null = null;
  private static readonly SEND_TIMEOUT_MS = 30_000;
  private static readonly AUTH_REQUEST_TIMEOUT_MS = 15_000;
  private static readonly TD_REQUEST_TIMEOUT_MS = 15_000;

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
    const { rawQuery, normalizedUsername, isUsernameQuery } =
      normalizeSearchQuery(query);
    if (!rawQuery) return [];

    const results: RankedChat[] = [];

    // 1. Exact public username (@username or a username-shaped query).
    if (isUsernameQuery) {
      const chat = await this.safeSearchPublicChat(tdlib, normalizedUsername);
      if (chat) results.push({ chat, source: 'public' });
    }

    // 2. Telegram contacts (the critical source searchChats misses).
    const contacts = await this.safeSearchContacts(tdlib, rawQuery, limit);
    for (const chat of contacts) results.push({ chat, source: 'contact' });

    // 3. Locally known chats.
    const local = await this.safeSearchLocalChats(tdlib, rawQuery, limit);
    for (const chat of local) results.push({ chat, source: 'local' });

    // 4. Server-known chats.
    const server = await this.safeSearchServerChats(tdlib, rawQuery, limit);
    for (const chat of server) results.push({ chat, source: 'server' });

    if (typeof __DEV__ === 'boolean' && __DEV__) {
      console.log('[telegram-search]', {
        queryType: isUsernameQuery ? 'username' : 'name',
        exactUsername: results.filter((r) => r.source === 'public').length,
        contacts: contacts.length,
        localChats: local.length,
        serverChats: server.length,
        merged: new Set(results.map((r) => r.chat.id)).size,
      });
    }

    return dedupeAndRank(results, rawQuery, normalizedUsername, isUsernameQuery).slice(
      0,
      limit,
    );
  }

  // ------------------------------------------------------------------
  // Recipient discovery helpers (composite search)
  // ------------------------------------------------------------------

  private async safeSearchPublicChat(
    tdlib: ReactNativeTdLib,
    username: string,
  ): Promise<TdChat | null> {
    try {
      const raw = await tdlib.searchPublicChat(username);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return await this.toTdChat(tdlib, parsed);
    } catch (error) {
      // Not-found / failure is an empty source, never a whole-search error.
      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.log('[telegram-search] searchPublicChat skipped', error instanceof Error ? error.message : error);
      }
      return null;
    }
  }

  private async safeSearchContacts(
    tdlib: ReactNativeTdLib,
    query: string,
    limit: number,
  ): Promise<TdChat[]> {
    try {
      const response = await this.sendTdRequest(tdlib, 'users', {
        '@type': 'searchContacts',
        query,
        limit: Math.min(Math.max(limit, 1), 50),
      });
      const userIds = response.user_ids;
      if (!Array.isArray(userIds)) return [];
      const chats: TdChat[] = [];
      for (const id of userIds) {
        const chat = await this.resolvePrivateChat(tdlib, Number(id));
        if (chat) chats.push(chat);
      }
      return chats;
    } catch (error) {
      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.log('[telegram-search] searchContacts skipped', error instanceof Error ? error.message : error);
      }
      return [];
    }
  }

  private async safeSearchLocalChats(
    tdlib: ReactNativeTdLib,
    query: string,
    limit: number,
  ): Promise<TdChat[]> {
    try {
      const raw = await tdlib.searchChats(query, Math.min(limit, 20));
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((chat) => normalizeChat(chat as Record<string, unknown>));
    } catch (error) {
      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.log('[telegram-search] local searchChats skipped', error instanceof Error ? error.message : error);
      }
      return [];
    }
  }

  private async safeSearchServerChats(
    tdlib: ReactNativeTdLib,
    query: string,
    limit: number,
  ): Promise<TdChat[]> {
    try {
      const response = await this.sendTdRequest(tdlib, 'chats', {
        '@type': 'searchChatsOnServer',
        query,
        limit: Math.min(Math.max(limit, 1), 50),
      });
      const chatIds = response.chat_ids;
      if (!Array.isArray(chatIds)) return [];
      const chats: TdChat[] = [];
      for (const id of chatIds) {
        const chat = await this.resolveChat(tdlib, Number(id));
        if (chat) chats.push(chat);
      }
      return chats;
    } catch (error) {
      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.log('[telegram-search] searchChatsOnServer skipped', error instanceof Error ? error.message : error);
      }
      return [];
    }
  }

  private async resolvePrivateChat(
    tdlib: ReactNativeTdLib,
    userId: number,
  ): Promise<TdChat | null> {
    try {
      const raw = await tdlib.createPrivateChat(userId);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return await this.toTdChat(tdlib, parsed);
    } catch {
      return null;
    }
  }

  private async resolveChat(
    tdlib: ReactNativeTdLib,
    chatId: number,
  ): Promise<TdChat | null> {
    try {
      const result = await tdlib.getChat(chatId);
      const raw = parseResultRaw(result as TdRawResultLike);
      return await this.toTdChat(tdlib, raw);
    } catch {
      return null;
    }
  }

  /** Normalize a raw chat and enrich a private chat's username from its user. */
  private async toTdChat(
    tdlib: ReactNativeTdLib,
    rawChat: Record<string, unknown>,
  ): Promise<TdChat> {
    const chat = normalizeChat(rawChat);
    if (chat.type === 'private' && !chat.username) {
      const rawType = rawChat.type as Record<string, unknown> | undefined;
      const userId = rawType?.user_id;
      if (typeof userId === 'number') {
        try {
          const userRaw = await tdlib.getUserProfile(userId);
          const user = mapTdUser(JSON.parse(userRaw) as Record<string, unknown>);
          if (user.username) return { ...chat, username: user.username };
        } catch {
          // Username is cosmetic enrichment; never fail the search over it.
        }
      }
    }
    return chat;
  }

  /**
   * Sends a raw TDLib JSON request through `td_json_client_send` and waits for
   * the correlated direct response. `react-native-tdlib` is fire-and-forget:
   * the response arrives on the `tdlib-update` stream with its own `@type`
   * (e.g. `users` for searchContacts, `chats` for searchChatsOnServer).
   *
   * Only one such request may be in flight at a time; the composite search
   * sends them sequentially, so response-type correlation is unambiguous.
   */
  private sendTdRequest(
    tdlib: ReactNativeTdLib,
    expectedType: string,
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (this.pendingTdRequest) {
      return Promise.reject(
        new Error('Another correlated TDLib request is already in flight'),
      );
    }
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const pending: PendingTdRequest = {
        expectedType,
        resolve,
        reject,
        timer: setTimeout(() => {
          if (this.pendingTdRequest === pending) this.pendingTdRequest = null;
          reject(new Error(`TDLib ${expectedType} request timed out`));
        }, NativeTdlibAdapter.TD_REQUEST_TIMEOUT_MS),
      };
      this.pendingTdRequest = pending;
      void tdlib.td_json_client_send(request).catch((error) => {
        if (this.pendingTdRequest === pending) this.pendingTdRequest = null;
        clearTimeout(pending.timer);
        reject(error);
      });
    });
  }

  async getRecentMessages(chatId: string, limit = 20): Promise<TdMessage[]> {
    const tdlib = this.assertModule();
    const numericChatId = parseChatId(chatId);
    try {
      const items = await tdlib.getChatHistory(numericChatId, 0, Math.min(limit, 50), 0);
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
    const numericChatId = parseChatId(chatId);
    let result: TdRawResultLike;
    try {
      result = await tdlib.sendMessage(numericChatId, text);
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

    if (this.pendingTdRequest) {
      clearTimeout(this.pendingTdRequest.timer);
      this.pendingTdRequest.reject(new Error('Adapter was closed.'));
      this.pendingTdRequest = null;
    }

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

      // Best-effort preload of recent chats so local `searchChats` has data on
      // a fresh session. Never blocks readiness, and failure does not
      // invalidate the Telegram session.
      void tdlib
        .loadChats(100)
        .catch(() => undefined);
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
    // Resolve correlated direct responses (from td_json_client_send) before
    // treating the event as a normal Telegram update.
    const pending = this.pendingTdRequest;
    if (pending) {
      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = JSON.parse(event.raw) as Record<string, unknown>;
      } catch {
        parsed = undefined;
      }
      if (parsed) {
        const responseType = String(parsed['@type'] ?? '');
        if (responseType === 'error') {
          this.pendingTdRequest = null;
          clearTimeout(pending.timer);
          pending.reject(
            new Error(
              typeof parsed.message === 'string'
                ? parsed.message
                : 'TDLib returned an error.',
            ),
          );
          return;
        }
        if (responseType === pending.expectedType) {
          this.pendingTdRequest = null;
          clearTimeout(pending.timer);
          pending.resolve(parsed);
          return;
        }
      }
    }

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

interface PendingTdRequest {
  expectedType: string;
  resolve: (value: Record<string, unknown>) => void;
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

/**
 * Defense in depth: a TDLib chat id is a decimal integer, never a username,
 * @username, display name or phone number. Reject non-numeric input before it
 * ever reaches native TDLib, so a model mistake fails fast as a recoverable
 * validation error instead of a `400 Chat not found`.
 */
function parseChatId(chatId: string): number {
  if (typeof chatId !== 'string' || !/^-?\d+$/.test(chatId)) {
    throw new ConnectorError(
      'Invalid Telegram chatId. Expected the numeric id returned by ' +
        'telegram.user.search_chats; usernames such as @example are not chat IDs.',
      'VALIDATION_FAILED',
    );
  }

  const value = Number(chatId);
  if (!Number.isFinite(value)) {
    throw new ConnectorError(
      'Telegram chatId is not a valid numeric ID.',
      'VALIDATION_FAILED',
    );
  }

  return value;
}

// ------------------------------------------------------------------
// Recipient search helpers (pure, exported for tests)
// ------------------------------------------------------------------

const USERNAME_RE = /^[A-Za-z0-9_]{5,32}$/u;

export function normalizeSearchQuery(query: string): {
  rawQuery: string;
  normalizedUsername: string;
  isUsernameQuery: boolean;
} {
  const rawQuery = query.trim();
  const normalizedUsername = rawQuery.startsWith('@')
    ? rawQuery.slice(1)
    : rawQuery;
  const isUsernameQuery =
    rawQuery.startsWith('@') || USERNAME_RE.test(rawQuery);
  return { rawQuery, normalizedUsername, isUsernameQuery };
}

export type SearchSource = 'public' | 'contact' | 'local' | 'server';

export interface RankedChat {
  chat: TdChat;
  source: SearchSource;
}

/**
 * Deduplicates strictly by `chat.id` (never title) and ranks: exact username
 * > exact title > username prefix > title prefix > other contacts > rest.
 */
export function dedupeAndRank(
  results: RankedChat[],
  rawQuery: string,
  normalizedUsername: string,
  isUsernameQuery: boolean,
): TdChat[] {
  const seen = new Set<string>();
  const unique: RankedChat[] = [];
  for (const entry of results) {
    if (!entry.chat.id || seen.has(entry.chat.id)) continue;
    seen.add(entry.chat.id);
    unique.push(entry);
  }

  const lowerQuery = rawQuery.toLowerCase();
  const lowerUsername = normalizedUsername.toLowerCase();

  return unique
    .map((entry) => ({
      entry,
      score: scoreChat(entry, lowerQuery, lowerUsername, isUsernameQuery),
    }))
    .sort(
      (a, b) =>
        a.score - b.score ||
        String(a.entry.chat.id).localeCompare(String(b.entry.chat.id)),
    )
    .map(({ entry }) => entry.chat);
}

function scoreChat(
  entry: RankedChat,
  lowerQuery: string,
  lowerUsername: string,
  isUsernameQuery: boolean,
): number {
  const title = (entry.chat.title ?? '').toLowerCase();
  const username = (entry.chat.username ?? '').toLowerCase();
  const isContact = entry.source === 'contact';

  if (isUsernameQuery && username && username === lowerUsername) return 0;
  if (title && title === lowerQuery) return 1;
  if (isUsernameQuery && username && username.startsWith(lowerUsername)) {
    return 2;
  }
  if (title && title.startsWith(lowerQuery)) return 3;
  if (!isUsernameQuery && username && username.startsWith(lowerQuery)) {
    return 3;
  }
  if (isContact) return 4;
  return 5;
}
