import { ConnectorError } from '@mobile-agent/connector-core';

import type {
  TdChat,
  TdlibAdapter,
  TdlibAuthState,
  TdlibAuthStateListener,
  TdMessage,
  TdSentMessage,
  TdUser,
} from './types';

export interface MockTdlibAdapterOptions {
  /** User the mock session belongs to. */
  user?: TdUser;
}

const DEFAULT_USER: TdUser = {
  id: '70000000',
  firstName: 'Dev',
  lastName: 'User',
  username: 'dev_user',
};

/**
 * Deterministic in-memory TDLib double.
 *
 * Used by unit/integration tests and development builds so the whole agent
 * loop (planner → MCP → approval → connector → result) is exercisable without
 * a real Telegram account. Conventions the tests rely on:
 *
 * - a query containing `empty` yields no chats;
 * - a chatId containing `fail` makes reads and sends throw;
 * - auth: any phone number → any 5-digit code → ready, except the code
 *   `22222`, which demands the password `password` first.
 */
export class MockTdlibAdapter implements TdlibAdapter {
  readonly kind = 'mock' as const;

  /** Every message "sent" through this adapter, for test assertions. */
  readonly sentMessages: TdSentMessage[] = [];

  private readonly user: TdUser;
  private state: TdlibAuthState = { type: 'not_initialized' };
  private listener: TdlibAuthStateListener | null = null;
  private messageCounter = 0;
  /** Chats materialised by searchChats — getRecentMessages only knows these. */
  private readonly knownChats = new Map<string, TdChat>();

  constructor(options: MockTdlibAdapterOptions = {}) {
    this.user = options.user ?? DEFAULT_USER;
  }

  async initialize(): Promise<void> {
    this.transition({ type: 'initializing' });
    this.transition({ type: 'wait_phone_number' });
  }

  /** Dev-only shortcut: skip the auth dance and land on a ready session. */
  restoreDevSession(): void {
    this.transition({ type: 'ready', user: this.user });
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
    if (this.state.type !== 'wait_phone_number') {
      throw new ConnectorError(
        `Cannot submit a phone number in state ${this.state.type}`,
        'VALIDATION_FAILED',
      );
    }
    if (!/^\+?[0-9]{7,15}$/u.test(phoneNumber.replace(/[\s()-]/gu, ''))) {
      throw new ConnectorError('Invalid phone number', 'VALIDATION_FAILED');
    }
    this.transition({ type: 'wait_code', codeLength: 5 });
  }

  async submitAuthCode(code: string): Promise<void> {
    if (this.state.type !== 'wait_code') {
      throw new ConnectorError(
        `Cannot submit a code in state ${this.state.type}`,
        'VALIDATION_FAILED',
      );
    }
    if (!/^\d{5}$/u.test(code)) {
      throw new ConnectorError('The code must be 5 digits', 'VALIDATION_FAILED');
    }
    if (code === '22222') {
      this.transition({ type: 'wait_password', passwordHint: 'dev hint' });
      return;
    }
    if (code === '33333') {
      this.transition({
        type: 'wait_email_address',
        allowAppleId: false,
        allowGoogleId: false,
      });
      return;
    }
    if (code === '44444') {
      this.transition({
        type: 'wait_registration',
        termsOfServiceText: 'Telegram Terms of Service (mock).',
      });
      return;
    }
    this.transition({ type: 'ready', user: this.user });
  }

  async submitPassword(password: string): Promise<void> {
    if (this.state.type !== 'wait_password') {
      throw new ConnectorError(
        `Cannot submit a password in state ${this.state.type}`,
        'VALIDATION_FAILED',
      );
    }
    if (password !== 'password') {
      throw new ConnectorError('Invalid 2FA password', 'AUTH_REQUIRED');
    }
    this.transition({ type: 'ready', user: this.user });
  }

  async submitEmailAddress(email: string): Promise<void> {
    if (this.state.type !== 'wait_email_address') {
      throw new ConnectorError(
        `Cannot submit an email in state ${this.state.type}`,
        'VALIDATION_FAILED',
      );
    }
    if (!email.includes('@')) {
      throw new ConnectorError('Invalid email address', 'VALIDATION_FAILED');
    }
    this.transition({
      type: 'wait_email_code',
      emailAddressPattern: email.replace(/^(.{1}).*(@.*)$/u, '$1***$2'),
      codeLength: 6,
    });
  }

  async submitEmailCode(code: string): Promise<void> {
    if (this.state.type !== 'wait_email_code') {
      throw new ConnectorError(
        `Cannot submit an email code in state ${this.state.type}`,
        'VALIDATION_FAILED',
      );
    }
    if (code !== '333333') {
      throw new ConnectorError('Invalid email code', 'VALIDATION_FAILED');
    }
    this.transition({ type: 'ready', user: this.user });
  }

  async submitRegistration(firstName: string, _lastName: string): Promise<void> {
    if (this.state.type !== 'wait_registration') {
      throw new ConnectorError(
        `Cannot submit registration in state ${this.state.type}`,
        'VALIDATION_FAILED',
      );
    }
    if (!firstName.trim()) {
      throw new ConnectorError('First name is required', 'VALIDATION_FAILED');
    }
    this.transition({ type: 'ready', user: this.user });
  }

  async searchChats(query: string, limit = 10): Promise<TdChat[]> {
    this.assertReady();
    const trimmed = query.trim();
    if (!trimmed) return [];
    if (/empty|пусто/iu.test(trimmed)) return [];

    const chat: TdChat = {
      id: String(mockChatIdFor(trimmed)),
      title: trimmed,
      type: 'private',
    };
    this.knownChats.set(chat.id, chat);
    return [chat].slice(0, Math.max(1, Math.min(limit, 20)));
  }

  async getRecentMessages(chatId: string, limit = 20): Promise<TdMessage[]> {
    this.assertReady();
    this.assertChatUsable(chatId);

    const chat = this.knownChats.get(chatId);
    const now = Date.now();
    const messages: TdMessage[] = [
      {
        id: `${chatId}-m3`,
        chatId,
        senderName: chat?.title ?? 'Contact',
        text: 'Привет! Как дела?',
        timestamp: new Date(now - 3 * 60_000).toISOString(),
        outgoing: false,
      },
      {
        id: `${chatId}-m2`,
        chatId,
        senderName: this.user.firstName ?? 'Me',
        text: 'Привет! Всё отлично.',
        timestamp: new Date(now - 2 * 60_000).toISOString(),
        outgoing: true,
      },
      {
        id: `${chatId}-m1`,
        chatId,
        senderName: chat?.title ?? 'Contact',
        text: 'Договорились.',
        timestamp: new Date(now - 60_000).toISOString(),
        outgoing: false,
      },
    ];

    return messages.slice(0, Math.max(1, Math.min(limit, 50)));
  }

  async sendMessage(chatId: string, text: string): Promise<TdSentMessage> {
    this.assertReady();
    this.assertChatUsable(chatId);

    this.messageCounter += 1;
    const sent: TdSentMessage = {
      messageId: `mock-msg-${this.messageCounter}`,
      chatId,
      text,
      sentAt: new Date().toISOString(),
    };
    this.sentMessages.push(sent);
    return sent;
  }

  async logOut(): Promise<void> {
    this.transition({ type: 'logging_out' });
    this.transition({ type: 'closed' });
  }

  async close(): Promise<void> {
    this.transition({ type: 'closed' });
  }

  private assertReady(): void {
    if (this.state.type !== 'ready') {
      throw new ConnectorError(
        'TDLib session is not ready (mock adapter)',
        'NOT_CONNECTED',
      );
    }
  }

  private assertChatUsable(chatId: string): void {
    if (chatId === MOCK_FAIL_CHAT_ID) {
      throw new ConnectorError(
        'Telegram rejected the request for this chat (mock failure)',
        'PROVIDER_ERROR',
      );
    }
  }

  private transition(next: TdlibAuthState): void {
    this.state = next;
    this.listener?.(next);
  }
}

/**
 * A reserved numeric chat id that makes `sendMessage`/`getRecentMessages`
 * fail, mirroring a provider-side rejection. Used by the tool-error test.
 */
const MOCK_FAIL_CHAT_ID = '-1';

/**
 * Deterministic numeric chat id for a query, so the mock still exposes real
 * TDLib-shaped ids (a decimal string) rather than a slug.
 */
function mockChatIdFor(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return 1_000_000_000 + (hash % 900_000_000);
}
