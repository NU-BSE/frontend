/**
 * The Kotlin resolver-core, driven over JSON stdio.
 *
 * The resolution engine lives in `resolver/` (Kotlin/JVM). This adapter spawns
 * the `resolver-cli` binary, sends the `McpSource` as JSON on stdin, and parses
 * the structured `ResolvedMcp` from stdout. Progress logs arrive on stderr
 * (mirroring the MCP stdio convention) and are read with bounded buffering.
 *
 * Secrets never cross this boundary: the CLI returns variable *names*, never
 * values; caller-supplied values are merged later in `toolset.ts`.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpResolutionError } from './errors';
import type {
  McpResolveOptions,
  McpResolver,
} from './resolver';
import type {
  McpRuntime,
  McpSource,
  RequiredEnvironmentVariable,
  ResolvedMcp,
} from './types';

const MAX_STDERR_BYTES = 64 * 1024;

export interface CliInvocation {
  command: string;
  args: string[];
}

export interface KotlinCliResolverOptions extends McpResolveOptions {
  /** Explicit CLI command (defaults to auto-detection). */
  cliCommand?: string;
  /** Extra args appended after `resolve`. */
  cliArgs?: string[];
  /** Spawn timeout for the resolver process itself. */
  timeoutMs?: number;
  /** Receives bounded stderr lines from the resolver process. */
  logger?: (line: string) => void;
}

interface CliErrorEnvelope {
  error?: {
    type?: string;
    message?: string;
    hints?: string[];
  };
}

/**
 * Locates the `resolver-cli` binary:
 *  1. `MCP_RESOLVER_CLI` (explicit);
 *  2. the Gradle `installDist` launcher in this monorepo;
 *  3. `java -jar` against the fat jar in this monorepo;
 *  4. `resolver-cli` on PATH.
 */
export function locateCli(): CliInvocation | null {
  return listCliCandidates()[0] ?? null;
}

/**
 * Ordered candidates for starting the resolver CLI:
 *  1. `MCP_RESOLVER_CLI` (explicit);
 *  2. the Gradle `installDist` launcher in this monorepo;
 *  3. `java -jar` against the fat jar in this monorepo;
 *  4. a WSL fallback for the fat jar (Windows Node + Linux JVM);
 *  5. `resolver-cli` on PATH.
 */
export function listCliCandidates(): CliInvocation[] {
  const candidates: CliInvocation[] = [];

  const explicit = process.env.MCP_RESOLVER_CLI;
  if (explicit) {
    const [command, ...args] = explicit.trim().split(/\s+/u);
    if (command) candidates.push({ command, args });
  }

  const repoRoot = findRepoRoot();
  const isWindows = process.platform === 'win32';

  if (repoRoot) {
    const launcher = path.join(
      repoRoot,
      'resolver',
      'build',
      'install',
      'resolver-cli',
      'bin',
      isWindows ? 'resolver-cli.bat' : 'resolver-cli',
    );
    if (existsSync(launcher)) candidates.push({ command: launcher, args: [] });

    const fatJar = path.join(repoRoot, 'resolver', 'build', 'libs', 'mcp-resolver-0.1.0-fat.jar');
    if (existsSync(fatJar)) {
      candidates.push({ command: 'java', args: ['-jar', fatJar] });
      if (isWindows) {
        candidates.push(wslJavaInvocation(fatJar));
      }
    }
  }

  candidates.push({ command: isWindows ? 'resolver-cli.cmd' : 'resolver-cli', args: [] });
  return candidates;
}

/** WSL interop: Windows Node cannot spawn a Linux JVM, but `wsl` can. */
function wslJavaInvocation(fatJar: string): CliInvocation {
  const linuxJar = toWslPath(fatJar);
  return {
    command: 'wsl',
    args: ['--', 'bash', '-lc', `exec java -jar ${linuxJar} "$@"`, 'resolver-cli'],
  };
}

function toWslPath(winPath: string): string {
  const match = /^([A-Za-z]):[\\/](.*)$/u.exec(winPath);
  if (!match) return winPath;
  return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replace(/[\\/]/gu, '/')}`;
}

function findRepoRoot(): string | null {
  let dir: string;
  if (typeof __dirname !== 'undefined') {
    dir = __dirname;
  } else {
    dir = path.dirname(fileURLToPath(import.meta.url));
  }
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, 'resolver', 'build'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export class KotlinCliResolver implements McpResolver {
  constructor(private readonly options: KotlinCliResolverOptions = {}) {}

  async resolve(source: McpSource, options: McpResolveOptions = {}): Promise<ResolvedMcp> {
    const merged: KotlinCliResolverOptions = { ...this.options, ...options };
    const explicitCandidates = merged.cliCommand
      ? [{ command: merged.cliCommand, args: merged.cliArgs ?? [] }]
      : listCliCandidates();

    const args = [
      'resolve',
      ...(merged.prepare === true ? ['--prepare'] : []),
      ...(merged.validate === false ? [] : ['--validate']),
      ...(merged.cliArgs ?? []),
    ];

    const input = JSON.stringify(toSourceJson(source));

    let lastSpawnError: McpResolutionError | null = null;
    for (const invocation of explicitCandidates) {
      try {
        const stdout = await runCli(invocation, args, input, {
          timeoutMs: merged.timeoutMs ?? 60_000,
          ...(merged.logger ? { logger: merged.logger } : {}),
        });
        const parsed = parseStdout(stdout, source);
        return mapResolved(parsed);
      } catch (error) {
        if (error instanceof McpResolutionError && error.type === 'CliNotAvailable') {
          // The candidate could not be spawned at all — try the next one
          // (e.g. a Linux JVM via `wsl` when the native `java` is absent).
          lastSpawnError = error;
          continue;
        }
        throw error;
      }
    }

    throw (
      lastSpawnError ??
      new McpResolutionError(
        'CliNotAvailable',
        'No resolver CLI invocation could be started.',
        ['Build it with: cd resolver && ./gradlew installDist fatJar'],
      )
    );
  }
}

function toSourceJson(source: McpSource): Record<string, string | undefined> {
  if (source.type === 'repository') {
    return source.ref !== undefined
      ? { url: source.url, ref: source.ref }
      : { url: source.url };
  }
  return { path: source.path };
}

function runCli(
  invocation: CliInvocation,
  args: string[],
  input: string,
  options: { timeoutMs: number; logger?: (line: string) => void },
): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(invocation.command, [...invocation.args, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (spawnError) {
      reject(
        new McpResolutionError(
          'CliNotAvailable',
          `Failed to spawn the resolver CLI (${invocation.command}): ${
            spawnError instanceof Error ? spawnError.message : String(spawnError)
          }`,
          ['Check that the JVM and the resolver-cli build are available.'],
          spawnError,
        ),
      );
      return;
    }

    let stdout = '';
    let stderrBytes = 0;
    const stderrTail: string[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      forceKill(child);
      reject(
        new McpResolutionError(
          'ProcessSpawnFailed',
          `The resolver CLI did not respond within ${options.timeoutMs}ms.`,
          ['Check that the JVM and the resolver-cli build are available.'],
        ),
      );
    }, options.timeoutMs);

    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      const remaining = Math.max(0, MAX_STDERR_BYTES - stderrBytes);
      stderrBytes += text.length;
      if (remaining > 0) stderrTail.push(text.slice(0, remaining));
      options.logger?.(text.trimEnd());
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new McpResolutionError(
          'CliNotAvailable',
          `Failed to start the resolver CLI (${invocation.command}): ${error.message}`,
          [
            'Build it with: cd resolver && ./gradlew installDist fatJar',
            'Or set MCP_RESOLVER_CLI to an explicit resolver-cli invocation.',
          ],
          error,
        ),
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // A resolution failure is reported as a structured `{ error }` envelope
      // on stdout AND a non-zero exit code. Parse stdout first so the typed
      // error wins over the raw exit code.
      const trimmed = stdout.trim();
      let parsed: CliErrorEnvelope | null = null;
      if (trimmed) {
        try {
          parsed = JSON.parse(trimmed) as CliErrorEnvelope;
        } catch {
          // Not JSON — fall through to the exit-code path.
        }
      }

      if (parsed?.error) {
        resolve(stdout);
        return;
      }

      if (code !== 0) {
        const tail = stderrTail.join('').trim();
        reject(
          new McpResolutionError(
            'ProcessSpawnFailed',
            `The resolver CLI exited with code ${code}.` +
              (tail ? ` ${tail.slice(0, 400)}` : ''),
            ['Inspect the resolver stderr output above.'],
          ),
        );
        return;
      }
      resolve(stdout);
    });

    child.stdin!.write(input);
    child.stdin!.end();
  });
}

function parseStdout(stdout: string, source: McpSource): CliErrorEnvelope & Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new McpResolutionError(
      'ProcessSpawnFailed',
      'The resolver CLI returned an empty response.',
      ['Check the resolver build and the source value.'],
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new McpResolutionError(
      'ProcessSpawnFailed',
      'The resolver CLI returned malformed JSON.',
      [`Source: ${JSON.stringify(source)}`],
    );
  }
  return parsed as CliErrorEnvelope & Record<string, unknown>;
}

function mapResolved(
  parsed: CliErrorEnvelope & Record<string, unknown>,
): ResolvedMcp {
  if (parsed.error) {
    const type = parsed.error.type ?? 'UnsupportedRepository';
    throw new McpResolutionError(
      toErrorType(type),
      parsed.error.message ?? `Resolver failed: ${type}`,
      parsed.error.hints ?? [],
    );
  }
  if (typeof parsed.command !== 'string') {
    throw new McpResolutionError('ProcessSpawnFailed', 'Resolver response has no command.');
  }

  return {
    command: parsed.command,
    args: asStringArray(parsed.args),
    environment: asStringMap(parsed.environment),
    workingDirectory: toNativePath(
      typeof parsed.workingDirectory === 'string' && parsed.workingDirectory.length > 0
        ? parsed.workingDirectory
        : '',
    ) || null,
    requiredEnvironmentVariables: asRequiredEnv(parsed.requiredEnvironmentVariables),
    runtime: (parsed.runtime as McpRuntime) ?? 'OTHER',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    evidence: asStringArray(parsed.evidence),
    requiresPreparation: parsed.requiresPreparation === true,
    launchDescription:
      typeof parsed.launchDescription === 'string' ? parsed.launchDescription : null,
  };
}

/**
 * WSL interop: a POSIX `/mnt/<drive>/...` working directory returned by a
 * Linux JVM must be converted to a native `X:\...` path before a Windows Node
 * can spawn into it. No-op on POSIX hosts.
 */
function toNativePath(value: string): string {
  if (value.length === 0) return '';
  if (process.platform !== 'win32') return value;
  const match = /^\/mnt\/([a-zA-Z])\/(.*)$/u.exec(value);
  if (!match) return value;
  return `${match[1]!.toUpperCase()}:\\${match[2]!.replace(/\//gu, '\\')}`;
}

function toErrorType(type: string): McpResolutionError['type'] {
  const known: McpResolutionError['type'][] = [
    'UnsupportedRepository',
    'RepositoryFetchFailed',
    'NoDetectorMatched',
    'RuntimeNotInstalled',
    'EntrypointNotFound',
    'MissingEnvironment',
    'PreparationFailed',
    'InvalidCommand',
    'StartupProbeFailed',
    'McpHandshakeFailed',
    'CliNotAvailable',
    'ProcessSpawnFailed',
  ];
  return (known as string[]).includes(type) ? (type as McpResolutionError['type']) : 'UnsupportedRepository';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asStringMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

function asRequiredEnv(value: unknown): RequiredEnvironmentVariable[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RequiredEnvironmentVariable[] => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.name !== 'string') return [];
    return [
      {
        name: record.name,
        required: record.required !== false,
        ...(typeof record.description === 'string' ? { description: record.description } : {}),
      },
    ];
  });
}

function forceKill(child: import('node:child_process').ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(child.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}