export type McpRuntimeMode = 'production' | 'development';

/**
 * Runtime mode resolution that works in every environment:
 * - React Native (Metro defines `__DEV__`): follows the bundler flag.
 * - Node verification scripts: development unless NODE_ENV=production.
 *
 * Set `EXPO_PUBLIC_MCP_RUNTIME_MODE=production` to force real connectors
 * in a development build — useful for testing Telegram TDLib with
 * hot reload and Metro dev server.
 */
export function isDevEnvironment(): boolean {
  if (typeof __DEV__ === 'boolean') return __DEV__;
  return (
    typeof process !== 'undefined' &&
    process.env?.NODE_ENV !== 'production'
  );
}

export function resolveDefaultRuntimeMode(): McpRuntimeMode {
  const explicit = process.env.EXPO_PUBLIC_MCP_RUNTIME_MODE;

  if (explicit === 'production') return 'production';
  if (explicit === 'development') return 'development';

  return isDevEnvironment() ? 'development' : 'production';
}
