/**
 * Universal stdio MCP server resolver + framework adapter.
 *
 * Layers, from bottom to top:
 *   resolver-core (Kotlin/JVM, `resolver/`)   — detection + resolution
 *   resolver-cli  (Kotlin/JVM, JSON stdio)     — bridge for non-JVM callers
 *   this package (`@mobile-agent/mcp-resolver`) — framework adapter
 *
 * The adapter spawns the Kotlin CLI to resolve a repository/directory into a
 * `ResolvedMcp`, then connects it through the official
 * `@modelcontextprotocol/client` stdio transport and exposes it as a toolset
 * the existing agent consumes (`AgentMcpClient`).
 */

export {
  KotlinCliResolver,
  isCliAvailable,
  listCliCandidates,
  locateCli,
} from './kotlinCli';
export type {
  CliInvocation,
  KotlinCliResolverOptions,
} from './kotlinCli';

export {
  McpToolsetConnection,
  createMcpToolset,
} from './toolset';
export type {
  McpToolset,
  McpToolsetOptions,
} from './toolset';

export {
  McpToolsetManager,
} from './manager';
export type {
  McpToolsetManagerOptions,
} from './manager';

export {
  McpResolutionError,
} from './errors';
export type {
  McpResolutionErrorType,
} from './errors';

export {
  isValidArgs,
  isValidCommand,
  validateResolved,
} from './commandSafety';

export {
  mergeEnvironment,
} from './environment';

export type {
  McpResolveOptions,
  McpResolver,
} from './resolver';

export type {
  McpRuntime,
  McpSource,
  McpTool,
  RequiredEnvironmentVariable,
  ResolutionResult,
  ResolvedMcp,
} from './types';

import { KotlinCliResolver } from './kotlinCli';
import type { McpResolveOptions } from './resolver';
import type {
  McpSource,
  ResolvedMcp,
} from './types';

/**
 * One-call convenience: resolve an MCP server source. `options.prepare`
 * additionally runs dependency install/build through the resolver CLI.
 */
export async function resolveMcp(
  source: McpSource,
  options: McpResolveOptions = {},
  logger?: (line: string) => void,
): Promise<ResolvedMcp> {
  const resolver = new KotlinCliResolver(
    logger ? { logger } : {},
  );
  return resolver.resolve(source, options);
}