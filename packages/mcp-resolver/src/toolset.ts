/**
 * Framework adapter: connects a resolved MCP server to the agent.
 *
 * This is the only layer that knows about `@modelcontextprotocol/client` and
 * the existing `AgentMcpClient`. It performs no detection or resolution — it
 * takes a `ResolvedMcp` and produces a process-backed toolset the agent can
 * consume:
 *
 *   ResolvedMcp
 *     → StdioClientTransport (spawn, stdin/stdout = protocol, stderr = logs)
 *     → Client.connect()        (initialize handshake)
 *     → listTools()             (handshake verification)
 *     → AgentMcpClient          (the existing agent-facing MCP client)
 *     → McpToolset
 *
 * Lifecycle: every toolset owns exactly one spawned process. `close()` performs
 * a graceful shutdown with a bounded grace period, then force-kills. Toolsets
 * must be closed on agent/application shutdown to avoid zombie processes.
 */

import {
  Client,
} from '@modelcontextprotocol/client';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/client/stdio';
import { AgentMcpClient } from '@mobile-agent/mcp-client';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { validateResolved } from './commandSafety';
import { mergeEnvironment } from './environment';
import {
  McpResolutionError,
  missingEnvironmentError,
} from './errors';
import type {
  McpTool,
  RequiredEnvironmentVariable,
  ResolvedMcp,
} from './types';

const MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_FORCE_KILL_GRACE_MS = 2_000;

export interface McpToolsetOptions {
  /** Caller-provided values for the server's required environment variables. */
  environment?: Record<string, string>;
  /** Client identity reported during `initialize`. */
  name?: string;
  version?: string;
  /** Timeout for the `initialize` handshake (and `listTools`). */
  connectTimeoutMs?: number;
  /** Aborts an in-flight connect (cancellation). */
  connectSignal?: AbortSignal;
  /** Receives bounded stderr lines from the MCP server process. */
  logger?: (line: string) => void;
  /** Grace period after close() before SIGKILL. Default 2000ms. */
  forceKillGraceMs?: number;
}

export interface McpToolset {
  readonly resolved: ResolvedMcp;
  /** The existing agent-facing MCP client (listTools + callTool). */
  readonly mcp: AgentMcpClient;
  readonly rawClient: Client;
  readonly transport: StdioClientTransport;
  readonly pid: number | null;
  /** Raw MCP tools, ready for the agent's tool mapper. */
  listTools(): Promise<McpTool[]>;
  callTool(call: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

export class McpToolsetConnection implements Omit<McpToolset, 'mcp'> {
  readonly rawClient: Client;
  readonly transport: StdioClientTransport;

  private readonly resolved_: ResolvedMcp;
  private readonly forceKillGraceMs: number;
  private closed = false;

  constructor(resolved: ResolvedMcp, options: McpToolsetOptions = {}) {
    validateResolved(resolved);

    const baseEnvironment = getDefaultEnvironment();
    const { environment, missing } = mergeEnvironment(resolved, options.environment, baseEnvironment);
    if (missing.length > 0) {
      throw missingEnvironmentError(missing[0] as RequiredEnvironmentVariable);
    }

    const resolvedExecutable = resolveExecutable(
      resolved.command,
      resolved.workingDirectory,
    );
    if (resolvedExecutable === null) {
      throw new McpResolutionError(
        'RuntimeNotInstalled',
        `Detected a ${resolved.runtime} MCP project, but the required runtime ` +
          `'${resolved.command}' was not found on PATH.`,
        [
          'Install the runtime and ensure it is on PATH, or resolve to an absolute command.',
          `Attempted: ${resolved.command} ${resolved.args.join(' ')}`,
        ],
      );
    }

    const name = options.name ?? 'creepyim-mcp-resolver-client';
    const version = options.version ?? '0.1.0';
    this.forceKillGraceMs = options.forceKillGraceMs ?? DEFAULT_FORCE_KILL_GRACE_MS;

    this.resolved_ = resolved;
    this.transport = new StdioClientTransport({
      command: resolved.command,
      args: resolved.args,
      env: environment,
      ...(resolved.workingDirectory !== null ? { cwd: resolved.workingDirectory } : {}),
      stderr: 'pipe',
    });
    this.rawClient = new Client({ name, version });

    this.attachStderrLogging(options.logger);
  }

  get resolved(): ResolvedMcp {
    return this.resolved_;
  }

  /** The spawned MCP process pid (null until the transport has started). */
  get pid(): number | null {
    return this.transport.pid;
  }

  /** Connects (spawns the process, runs `initialize`), then verifies tools. */
  async connect(options: McpToolsetOptions = {}): Promise<void> {
    const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    try {
      await this.rawClient.connect(this.transport, {
        timeout: connectTimeoutMs,
        ...(options.connectSignal ? { signal: options.connectSignal } : {}),
      });
    } catch (error) {
      await this.terminateProcess();
      const message =
        error instanceof Error ? error.message : String(error);
      throw new McpResolutionError(
        'McpHandshakeFailed',
        `MCP handshake (initialize) with ${this.resolved_.command} failed: ${message}`,
        [
          'The server may be broken, missing dependencies, or the command is wrong.',
          `Attempted: ${this.resolved_.command} ${this.resolved_.args.join(' ')}`,
        ],
        error,
      );
    }

    // Verify the server actually answers tools/list (a server that exits
    // without any output is indistinguishable from a broken one by stdout
    // alone — MCP stdout is the protocol).
    try {
      await this.rawClient.listTools(undefined, { timeout: connectTimeoutMs });
    } catch (error) {
      await this.terminateProcess();
      const message = error instanceof Error ? error.message : String(error);
      throw new McpResolutionError(
        'McpHandshakeFailed',
        `MCP tools/list failed for ${this.resolved_.command}: ${message}`,
        ['The process started but did not answer the MCP protocol.'],
        error,
      );
    }
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.rawClient.listTools();
    return result.tools as McpTool[];
  }

  async callTool(call: { name: string; arguments: Record<string, unknown> }): Promise<unknown> {
    return this.rawClient.callTool({ name: call.name, arguments: call.arguments });
  }

  /** Graceful shutdown, then force-kill after the grace period. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await this.terminateProcess();
  }

  private async terminateProcess(): Promise<void> {
    const transport = this.transport;
    const pid = transport.pid;

    // Graceful: close the client (which closes the transport and terminates
    // the child). If that hangs, force-kill after the grace period.
    await Promise.race([
      this.rawClient.close().catch(() => {
        // Fall through to transport close / force kill.
      }),
      new Promise<void>((resolve) => {
        setTimeout(resolve, this.forceKillGraceMs);
      }),
    ]);

    if (pid !== null && pid !== undefined) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }

    await transport.close().catch(() => {
      // Already closed.
    });
  }

  private attachStderrLogging(logger?: (line: string) => void): void {
    const stderr = this.transport.stderr;
    if (!stderr || !logger) return;

    let buffered = 0;
    stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      buffered += text.length;
      if (buffered > MAX_STDERR_BYTES) return;
      logger(text.trimEnd());
    });
    stderr.on('error', () => {
      // Read errors are not fatal for the protocol.
    });
  }
}

/**
 * Resolves a launch command to an existing executable in the *spawn*
 * environment (Windows and POSIX PATH aware). Returns null when not found.
 */
export function resolveExecutable(
  command: string,
  workingDirectory: string | null,
): string | null {
  if (isAbsolutePath(command)) {
    return existsSync(command) ? command : null;
  }
  if (command.startsWith('./')) {
    const base = workingDirectory ?? process.cwd();
    const candidate = path.join(base, command.slice(2));
    return existsSync(candidate) ? candidate : null;
  }

  const pathEnv = process.env.PATH ?? '';
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function isAbsolutePath(command: string): boolean {
  return path.isAbsolute(command);
}

/**
 * Creates a process-backed toolset for a resolved server. The process is
 * spawned lazily on the first use via `connect()` (or directly here).
 *
 * The returned toolset must be closed (`close()`) when the agent shuts down or
 * the server is no longer needed — otherwise the MCP subprocess leaks.
 */
export async function createMcpToolset(
  resolved: ResolvedMcp,
  options: McpToolsetOptions = {},
): Promise<McpToolset> {
  const connection = new McpToolsetConnection(resolved, options);
  await connection.connect(options);
  const mcp = new AgentMcpClient(connection.rawClient);

  const toolset: McpToolset = {
    get resolved() {
      return connection.resolved;
    },
    get mcp() {
      return mcp;
    },
    get rawClient() {
      return connection.rawClient;
    },
    get transport() {
      return connection.transport;
    },
    get pid() {
      return connection.pid;
    },
    async listTools() {
      return connection.listTools();
    },
    async callTool(call: { name: string; arguments: Record<string, unknown> }) {
      return mcp.callTool(call);
    },
    async close() {
      return connection.close();
    },
  };
  return toolset;
}