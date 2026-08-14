import type { DocumentSourceAdapter } from '../../contracts/adapters';

/** Telegram attachment source boundary. */
export interface TelegramSourceAdapter extends DocumentSourceAdapter {
  readonly id: 'telegram';
  readonly sources: readonly ['telegram'];
}
