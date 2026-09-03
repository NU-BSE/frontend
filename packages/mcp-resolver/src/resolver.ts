/**
 * The resolver interface. Implementations answer one question: "how do I run
 * this MCP server over stdio?" — nothing about agents or tool registries.
 */

import type {
  McpSource,
  ResolvedMcp,
} from './types';

export interface McpResolveOptions {
  /**
   * Run the preparation step (install/build dependencies) before returning.
   * Defaults to false — resolution stays side-effect free.
   */
  prepare?: boolean;
  /**
   * Run static startup validation (executable on PATH, entrypoint exists).
   * Defaults to true.
   */
  validate?: boolean;
}

export interface McpResolver {
  resolve(source: McpSource, options?: McpResolveOptions): Promise<ResolvedMcp>;
}