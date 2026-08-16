import type { McpRuntimeMode } from './runtime-mode';

export type TelegramAdapterMode = 'native' | 'mock';

/**
 * Resolves which Telegram TDLib adapter to use.
 *
 * Native unless `EXPO_PUBLIC_TELEGRAM_ADAPTER=mock` asks for the mock.
 *
 * This used to follow the runtime mode, so every development build silently
 * ran the mock. That is the wrong default for a screen that shows real chats:
 * a debug build reported "TDLib: mock" and answered with invented data, and
 * the only way to see the real thing was to remember an environment variable.
 * eas.json sets `native` on every profile, which is the same conclusion
 * reached one build profile at a time — so it is the default here, and a mock
 * has to be asked for by name.
 *
 * `runtimeMode` is still taken so the signature can express a mode-dependent
 * policy again without touching every call site.
 */
export function resolveTelegramAdapterMode(
  _runtimeMode: McpRuntimeMode,
): TelegramAdapterMode {
  return process.env.EXPO_PUBLIC_TELEGRAM_ADAPTER === 'mock' ? 'mock' : 'native';
}
