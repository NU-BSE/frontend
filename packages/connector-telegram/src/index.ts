export { TelegramBotConnector } from './telegram-bot-connector';
export {
  TelegramUserConnector,
  TELEGRAM_USER_SCOPES,
  type TelegramUserConnectorOptions,
} from './telegram-user-connector';
export { MockTdlibAdapter } from './tdlib/mock-adapter';
export { NativeTdlibAdapter } from './tdlib/bridge';
export type {
  TdChat,
  TdlibAdapter,
  TdlibAuthState,
  TdlibAuthStateListener,
  TdlibAuthStateType,
  TdMessage,
  TdSentMessage,
  TdUser,
} from './tdlib/types';
export { TdlibUnavailableError } from './tdlib/types';

/**
 * Type-guard for connectors that expose a TDLib adapter for
 * interactive auth flows.
 */
export function getTelegramAdapter(
  connector: unknown,
): import('./tdlib/types').TdlibAdapter | undefined {
  const c = connector as { getAdapter?: () => import('./tdlib/types').TdlibAdapter };
  return c.getAdapter?.();
}
