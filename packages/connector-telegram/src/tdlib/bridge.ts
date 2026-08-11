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
  } catch {
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

/**
 * Production TDLib bridge using `react-native-tdlib`.
 *
 * Lazy-loads the native module so Node test environments (verify:mcp,
 * verify:agent, verify:routing) remain loadable. TDLib updates arrive
 * through React Native's `NativeEventEmitter` and are mapped to the
 * `TdlibAuthState` state machine before propagating to listeners.
 */
export class NativeTdlibAdapter implements TdlibAdapter {
  readonly kind = 'native' as const;

  private tdlib: ReactNativeTdLib | null = null;
  private config: TelegramConfig | null = null;

  private state: TdlibAuthState = { type: 'not_initialized' };
  private listener: TdlibAuthStateListener | null = null;
  private emitterSubscription: { remove: () => void } | null = null;

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
      throw mapTdlibError(error, 'initialization');
    }

    // Reconcile: TDLib may already have a running session.
    // Calls getAuthorizationState() and resolves the user profile if ready.
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

  async requestPhoneNumber(phoneNumber: string): Promise<void> {
    const tdlib = this.assertModule();
    const cleaned = validatePhoneNumber(phoneNumber);
    const { countrycode, phoneNumber: localNumber } = parsePhoneNumber(cleaned);

    try {
      await tdlib.login({ countrycode, phoneNumber: localNumber });
    } catch (error) {
      throw mapTdlibError(error, 'phone number submission');
    }
  }

  async submitAuthCode(code: string): Promise<void> {
    const tdlib = this.assertModule();
    try {
      await tdlib.verifyPhoneNumber(code);
    } catch (error) {
      throw mapTdlibError(error, 'code verification');
    }
  }

  async submitPassword(password: string): Promise<void> {
    const tdlib = this.assertModule();
    try {
      await tdlib.verifyPassword(password);
    } catch (error) {
      throw mapTdlibError(error, 'password verification');
    }
  }

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
      throw mapTdlibError(error, 'search');
    }
  }

  async getRecentMessages(chatId: string, limit = 20): Promise<TdMessage[]> {
    const tdlib = this.assertModule();
    try {
      const items = await tdlib.getChatHistory(
        Number(chatId),
        0,
        Math.min(limit, 50),
        0,
      );

      if (!Array.isArray(items)) return [];

      return items
        .map((item) => {
          try {
            return JSON.parse(item.raw_json) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((raw): raw is Record<string, unknown> => raw != null)
        .map(normalizeMessage);
    } catch (error) {
      throw mapTdlibError(error, 'reading messages');
    }
  }

  async sendMessage(chatId: string, text: string): Promise<TdSentMessage> {
    const tdlib = this.assertModule();
    try {
      const result = await tdlib.sendMessage(Number(chatId), text);
      const raw =
        typeof result.raw === 'string'
          ? (JSON.parse(result.raw) as Record<string, unknown>)
          : (result as unknown as Record<string, unknown>);

      assertNotTdlibError(raw);

      const messageId = raw.id;
      if (
        messageId === undefined ||
        messageId === null ||
        (typeof messageId === 'string' && messageId.length === 0)
      ) {
        throw new Error('Telegram did not confirm the message (no message id).');
      }

      return normalizeSentMessage(chatId, text, raw);
    } catch (error) {
      throw mapTdlibError(error, 'sending message');
    }
  }

  async logOut(): Promise<void> {
    const tdlib = this.assertModule();
    try {
      await tdlib.logout();
    } catch (error) {
      throw mapTdlibError(error, 'logout');
    }
  }

  async close(): Promise<void> {
    if (this.emitterSubscription) {
      this.emitterSubscription.remove();
      this.emitterSubscription = null;
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

  /**
   * After `startTdLib()`, explicitly query TDLib for the current
   * authorization state.  This is necessary because TDLib may already
   * have a running session and will not emit a fresh
   * `updateAuthorizationState` event.
   */
  private async reconcileAuthorizationState(
    tdlib: ReactNativeTdLib,
  ): Promise<void> {
    try {
      const raw = await tdlib.getAuthorizationState();
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (isTdlibReadyState(parsed)) {
        await this.resolveReadyUser(tdlib);
        return;
      }

      const mapped = mapAuthorizationState(parsed);
      this.transition(mapped);
    } catch (error) {
      // Reconciliation failure is not fatal — events may still arrive.
      this.transition({
        type: 'error',
        message: 'Failed to reconcile Telegram authorization state.',
      });
    }
  }

  private async resolveReadyUser(
    tdlib: ReactNativeTdLib,
  ): Promise<void> {
    try {
      const profileRaw = await tdlib.getProfile();
      const profile = JSON.parse(profileRaw) as Record<string, unknown>;
      const user = mapTdUser(profile);

      if (!user.id) {
        this.transition({
          type: 'error',
          message: 'Telegram profile did not return a valid user id.',
        });
        return;
      }

      this.transition({ type: 'ready', user });
    } catch {
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
      // NativeEventEmitter unavailable (Node test). Updates must be polled.
    }
  }

  private async handleTdlibUpdate(
    tdlib: ReactNativeTdLib,
    event: { type: string; raw: string },
  ): Promise<void> {
    if (event.type !== 'updateAuthorizationState') return;

    let update: Record<string, unknown>;
    try {
      update = JSON.parse(event.raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const authState =
      update.authorization_state as Record<string, unknown> | undefined;

    if (
      authState &&
      isTdlibReadyState(authState)
    ) {
      await this.resolveReadyUser(tdlib);
      return;
    }

    const nextState = mapAuthorizationState(authState ?? null);
    this.transition(nextState);
  }

  private transition(next: TdlibAuthState): void {
    this.state = next;
    this.listener?.(next);
  }
}

/**
 * Returns true when a raw TDLib authorization state object represents the
 * "Ready" state. This check runs BEFORE profile loading so we never
 * create an application-level `ready` state with an empty user.
 */
function isTdlibReadyState(raw: Record<string, unknown>): boolean {
  const type = raw['@type'] ?? (raw as Record<string, unknown>)['_'] ?? '';
  return String(type).replace(/^authorizationState/, '') === 'Ready';
}

/**
 * Throws if `raw` is a TDLib error object.
 * `react-native-tdlib` may resolve the Promise with a TDLib Error
 * instead of rejecting — without this check a failed send would be
 * silently accepted as success.
 */
function assertNotTdlibError(raw: Record<string, unknown>): void {
  const type = raw['@type'] ?? raw['_'] ?? '';
  if (type === 'error') {
    const code = raw.code ?? '';
    const message =
      typeof raw.message === 'string' ? raw.message : 'TDLib returned an error.';
    throw new Error(`TDLib error ${String(code)}: ${message}`);
  }
}
