/**
 * The seam between TypeScript and TDLib.
 *
 * The production path is:
 *
 *   TelegramUserConnector → TdlibAdapter → Expo native module → Kotlin → TDLib
 *
 * Tests and development builds plug in `MockTdlibAdapter` instead; the
 * connector cannot tell the difference. Nothing above this layer ever sees
 * verification codes, 2FA passwords or the TDLib database key — those stay
 * inside the adapter/native side.
 */

export type TdlibAuthStateType =
  | 'not_initialized'
  | 'initializing'
  | 'wait_phone_number'
  | 'wait_code'
  | 'wait_email_address'
  | 'wait_email_code'
  | 'wait_password'
  | 'wait_registration'
  | 'wait_other_device_confirmation'
  | 'wait_premium_purchase'
  | 'ready'
  | 'logging_out'
  | 'closed'
  | 'error';

export interface TdUser {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
}

export interface TdChat {
  id: string;
  title: string;
  username?: string;
  type: 'private' | 'group' | 'channel' | 'unknown';
}

export interface TdMessage {
  id: string;
  chatId: string;
  senderName?: string;
  text: string;
  /** ISO 8601. */
  timestamp: string;
  outgoing: boolean;
}

export interface TdSentMessage {
  messageId: string;
  chatId: string;
  text: string;
  /** ISO 8601. */
  sentAt: string;
}

export type TdlibAuthState =
  | { type: 'not_initialized' }
  | { type: 'initializing' }
  | { type: 'wait_phone_number' }
  | {
      type: 'wait_code';
      codeLength?: number;
      phoneNumber?: string;
      timeoutSeconds?: number;
    }
  | {
      type: 'wait_email_address';
      allowAppleId?: boolean;
      allowGoogleId?: boolean;
    }
  | {
      type: 'wait_email_code';
      emailAddressPattern?: string;
      codeLength?: number;
      allowAppleId?: boolean;
      allowGoogleId?: boolean;
    }
  | {
      type: 'wait_password';
      passwordHint?: string;
    }
  | {
      type: 'wait_registration';
      termsOfServiceText?: string;
    }
  | {
      type: 'wait_other_device_confirmation';
      link: string;
    }
  | {
      type: 'wait_premium_purchase';
      supportEmail?: string;
    }
  | { type: 'ready'; user: TdUser }
  | { type: 'logging_out' }
  | { type: 'closed' }
  | {
      type: 'error';
      message: string;
      recoverable?: boolean;
    };

export type TdlibAuthStateListener = (state: TdlibAuthState) => void;

export interface TdlibAdapter {
  /** 'native' talks to TDLib; 'mock' is the deterministic dev/test double. */
  readonly kind: 'native' | 'mock';

  initialize(): Promise<void>;
  getAuthState(): TdlibAuthState;
  /** Returns an unsubscribe function. */
  setAuthStateListener(listener: TdlibAuthStateListener): () => void;

  /**
   * Auth state machine drives these. One-time codes, passwords and
   * registration data are passed straight to TDLib and must never be
   * persisted or logged.
   */
  requestPhoneNumber(phoneNumber: string): Promise<void>;
  submitAuthCode(code: string): Promise<void>;
  submitEmailAddress(email: string): Promise<void>;
  submitEmailCode(code: string): Promise<void>;
  submitPassword(password: string): Promise<void>;
  submitRegistration(firstName: string, lastName: string): Promise<void>;

  searchChats(query: string, limit?: number): Promise<TdChat[]>;
  getRecentMessages(chatId: string, limit?: number): Promise<TdMessage[]>;
  sendMessage(chatId: string, text: string): Promise<TdSentMessage>;

  logOut(): Promise<void>;
  close(): Promise<void>;
}

export class TdlibUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TdlibUnavailableError';
  }
}
