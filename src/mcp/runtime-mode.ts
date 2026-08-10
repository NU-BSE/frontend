export type McpRuntimeMode = 'production' | 'development';

/**
 * Runtime mode resolution that works in every environment:
 * - React Native (Metro defines `__DEV__`): follows the bundler flag.
 * - Node verification scripts: development unless NODE_ENV=production.
 */
export function isDevEnvironment(): boolean {
  if (typeof __DEV__ === 'boolean') return __DEV__;
  return (
    typeof process !== 'undefined' &&
    process.env?.NODE_ENV !== 'production'
  );
}

export function resolveDefaultRuntimeMode(): McpRuntimeMode {
  return isDevEnvironment() ? 'development' : 'production';
}
