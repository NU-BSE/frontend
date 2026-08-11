import {
  TdlibUnavailableError,
  type TdChat,
  type TdlibAdapter,
  type TdlibAuthState,
  type TdlibAuthStateListener,
  type TdMessage,
  type TdSentMessage,
} from './types';
import { mapAuthorizationState, mapTdUser, parsePhoneNumber } from './auth-state-mapper';
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
    const { countrycode, phoneNumber: localNumber } = parsePhoneNumber(phoneNumber);

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
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const chatIds = parsed.chat_ids as number[] | undefined;

      if (!chatIds) return [];

      const chatsRaw = JSON.stringify(Object.entries(parsed).filter(
        ([key]) => key !== 'chat_ids' && key !== '@type' && key !== '_' && key !== 'total_count',
      ));

      // react-native-tdlib searchChats returns the full chat map keyed by id.
      // Extract chat entries that match the returned ids.
      const results: TdChat[] = [];
      for (const key of Object.keys(parsed)) {
        if (key === 'chat_ids' || key === '@type' || key === '_' || key === 'total_count') continue;
        const chatObj = parsed[key] as Record<string, unknown> | undefined;
        if (chatObj?.id && chatIds.includes(Number(chatObj.id))) {
          results.push(normalizeChat(chatObj));
        }
      }

      if (results.length === 0 && typeof parsed.chat_ids === 'string') {
        // Fallback: searchChats may return IDs only. Use getChats to load them.
        const chatsList = await tdlib.getChats(limit);
        const allChats = JSON.parse(chatsList) as Record<string, unknown>[];
        const idMap = new Set(chatIds.map(String));
        return allChats
          .filter((chat) => idMap.has(String(chat.id)))
          .slice(0, limit)
          .map(normalizeChat);
      }

      return results.slice(0, limit);
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

  private assertModule(): ReactNativeTdLib {
    if (!this.tdlib) {
      throw new TdlibUnavailableError('NativeTdlibAdapter is not initialized');
    }
    return this.tdlib;
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

    const authState = update.authorization_state as Record<string, unknown> | undefined;
    const nextState = mapAuthorizationState(authState ?? null);

    if (nextState.type === 'ready') {
      try {
        const profileRaw = await tdlib.getProfile();
        const profile = JSON.parse(profileRaw) as Record<string, unknown>;
        const user = mapTdUser(profile);
        this.transition({ type: 'ready', user });
        return;
      } catch {
        this.transition(nextState);
        return;
      }
    }

    this.transition(nextState);
  }

  private transition(next: TdlibAuthState): void {
    this.state = next;
    this.listener?.(next);
  }
}
