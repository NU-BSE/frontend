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
