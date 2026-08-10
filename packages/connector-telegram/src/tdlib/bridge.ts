import {
  TdlibUnavailableError,
  type TdChat,
  type TdlibAdapter,
  type TdlibAuthState,
  type TdlibAuthStateListener,
  type TdMessage,
  type TdSentMessage,
} from './types';

/**
 * Native TDLib bridge (Phase D seam).
 *
 * Expects an Expo native module named `TelegramTdlibModule` (Kotlin under
 * `modules/telegram-tdlib/android/...`) exposing the same surface as
 * `TdlibAdapter`. Until that module is built, `initialize()` throws
 * `TdlibUnavailableError` — the connector reports an honest error instead of
 * pretending to talk to Telegram.
 *
 * The require is lazy and guarded so this file stays loadable in Node tests
 * where expo-modules-core does not exist.
 */
export class NativeTdlibAdapter implements TdlibAdapter {
  readonly kind = 'native' as const;

  private module: TdlibAdapter | null = null;
  private state: TdlibAuthState = { type: 'not_initialized' };
  private listener: TdlibAuthStateListener | null = null;

  async initialize(): Promise<void> {
    if (this.module) return;

    let nativeModule: unknown = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { requireNativeModule } = require('expo-modules-core');
      nativeModule = requireNativeModule('TelegramTdlibModule');
    } catch {
      nativeModule = null;
    }

    if (!nativeModule || typeof (nativeModule as TdlibAdapter).initialize !== 'function') {
      throw new TdlibUnavailableError(
        'The TelegramTdlibModule native module is not available. Telegram ' +
          'personal-account support requires a development build with TDLib ' +
          '(Phase D); until then, connect Telegram in a dev build or use the ' +
          'mock adapter.',
      );
    }

    this.module = nativeModule as TdlibAdapter;
    await this.module.initialize();
    this.state = this.module.getAuthState();
  }

  getAuthState(): TdlibAuthState {
    return this.module ? this.module.getAuthState() : this.state;
  }

  setAuthStateListener(listener: TdlibAuthStateListener): () => void {
    this.listener = listener;
    if (this.module) return this.module.setAuthStateListener(listener);
    listener(this.state);
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  async requestPhoneNumber(phoneNumber: string): Promise<void> {
    await this.assertModule().then((m) => m.requestPhoneNumber(phoneNumber));
  }

  async submitAuthCode(code: string): Promise<void> {
    await this.assertModule().then((m) => m.submitAuthCode(code));
  }

  async submitPassword(password: string): Promise<void> {
    await this.assertModule().then((m) => m.submitPassword(password));
  }

  async searchChats(query: string, limit?: number): Promise<TdChat[]> {
    return this.assertModule().then((m) => m.searchChats(query, limit));
  }

  async getRecentMessages(chatId: string, limit?: number): Promise<TdMessage[]> {
    return this.assertModule().then((m) => m.getRecentMessages(chatId, limit));
  }

  async sendMessage(chatId: string, text: string): Promise<TdSentMessage> {
    return this.assertModule().then((m) => m.sendMessage(chatId, text));
  }

  async logOut(): Promise<void> {
    await this.assertModule().then((m) => m.logOut());
  }

  async close(): Promise<void> {
    if (this.module) await this.module.close();
  }

  private assertModule(): Promise<TdlibAdapter> {
    if (!this.module) {
      return Promise.reject(
        new TdlibUnavailableError('NativeTdlibAdapter is not initialized'),
      );
    }
    return Promise.resolve(this.module);
  }
}
