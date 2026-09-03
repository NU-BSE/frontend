/**
 * Owns the lifecycle of zero-or-more process-backed toolsets.
 *
 * Prevents duplicate MCP processes when the agent is re-initialized for the
 * same resolved server, and guarantees every spawned process is closed on
 * application shutdown.
 */

import type { ResolvedMcp } from './types';
import type {
  McpToolset,
  McpToolsetOptions,
} from './toolset';
import { createMcpToolset } from './toolset';

export interface McpToolsetManagerOptions extends McpToolsetOptions {
  /** Key used when the caller does not supply one (defaults to a command hash). */
  defaultKey?: string;
}

export class McpToolsetManager {
  private readonly toolsets = new Map<string, McpToolset>();

  constructor(private readonly options: McpToolsetManagerOptions = {}) {}

  /** Returns the existing toolset for [key], or creates (and stores) one. */
  async get(key: string, resolved: ResolvedMcp): Promise<McpToolset> {
    const existing = this.toolsets.get(key);
    if (existing) return existing;

    const toolset = await createMcpToolset(resolved, this.options);
    this.toolsets.set(key, toolset);
    return toolset;
  }

  async remove(key: string): Promise<void> {
    const toolset = this.toolsets.get(key);
    if (!toolset) return;
    this.toolsets.delete(key);
    await toolset.close();
  }

  /** Closes every toolset. Idempotent; safe to call on application shutdown. */
  async closeAll(): Promise<void> {
    const entries = [...this.toolsets.entries()];
    this.toolsets.clear();
    await Promise.allSettled(entries.map(([, toolset]) => toolset.close()));
  }

  get size(): number {
    return this.toolsets.size;
  }
}