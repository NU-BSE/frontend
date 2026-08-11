import type { McpRuntimeMode } from './runtime-mode';

export type TelegramAdapterMode = 'native' | 'mock';

/**
 * Resolves which Telegram TDLib adapter to use.
 *
 * By default follows the runtime mode (mock in development, native in
 * production), but can be overridden via `EXPO_PUBLIC_TELEGRAM_ADAPTER`
 * so developers can test real TDLib in a dev build without forcing
 * the entire MCP runtime into production mode.
 */
export function resolveTelegramAdapterMode(
  runtimeMode: McpRuntimeMode,
): TelegramAdapterMode {
  const explicit = process.env.EXPO_PUBLIC_TELEGRAM_ADAPTER;

  if (explicit === 'native') return 'native';
  if (explicit === 'mock') return 'mock';

  return runtimeMode === 'development' ? 'mock' : 'native';
}
