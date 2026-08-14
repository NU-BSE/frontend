import { TELEGRAM_USER_SCOPES } from '@mobile-agent/connector-telegram';

/**
 * Plain-language descriptions of the Telegram capabilities, for the consent
 * step.
 *
 * Derived from `TELEGRAM_USER_SCOPES` for the same reason as the Google copy:
 * a capability added to the connector cannot fail to appear on the screen that
 * discloses it. An unrecognised scope falls back to its raw identifier rather
 * than being dropped.
 *
 * Telegram differs from Google in a way worth stating on the screen. There is
 * no scope dialog and no per-scope consent — signing in with a phone number
 * grants the app the whole account, and TDLib holds a real user session. This
 * screen is the only place that boundary is described, so it says what the
 * tools do rather than implying Telegram enforces a limit it does not.
 */

export interface TelegramCapabilityDescription {
  scope: string;
  title: string;
  detail: string;
}

const DESCRIPTIONS: Record<string, { title: string; detail: string }> = {
  'telegram.chats.read': {
    title: 'Find your chats',
    detail: 'Search your chat list by name to identify who a message is for.',
  },
  'telegram.messages.read': {
    title: 'Read recent messages',
    detail: 'Read recent messages in a chat you name, to summarise or answer questions about it.',
  },
  'telegram.messages.send': {
    title: 'Send messages, with your approval',
    detail:
      'Every send is shown to you with the exact chat and text, and is only sent after you approve it.',
  },
};

export const TELEGRAM_CAPABILITY_DESCRIPTIONS: TelegramCapabilityDescription[] =
  TELEGRAM_USER_SCOPES.map((scope) => {
    const known = DESCRIPTIONS[scope];
    return {
      scope,
      title: known?.title ?? scope,
      detail: known?.detail ?? 'Requested by this connector.',
    };
  });
