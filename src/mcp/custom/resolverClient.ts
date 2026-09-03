/**
 * Talking to a resolver host.
 *
 * The resolver clones repositories, runs package managers and spawns MCP
 * servers over stdio. That needs a filesystem, a process table and a JVM, so
 * it runs on a host and the app asks it over HTTP. `EXPO_PUBLIC_MCP_RESOLVER_URL`
 * names that host; with it unset there is no resolver and the UI says so
 * rather than pretending.
 *
 * The wire format is the resolver's own `ResolvedMcp` JSON — the same object
 * `resolver-cli` writes to stdout — so a host is a thin transport over the
 * existing CLI rather than a reimplementation of it.
 */

import * as z from 'zod/v4';

import type {
  CustomMcpSource,
  DetectedMcp,
} from './types';

/**
 * The configured resolver host, or an empty string.
 *
 * Read through a function rather than a module constant. Metro substitutes
 * `process.env.EXPO_PUBLIC_*` at build time by matching that exact member
 * expression — which it still does inside a function body, so the literal
 * requirement is met either way — but a constant also freezes the value at
 * module evaluation, which makes the transport untestable and means the order
 * of imports decides what the app sees.
 *
 * The literal syntax is not optional: through an alias or a destructure the
 * match fails, nothing is substituted, and the value is `undefined` in a
 * release bundle while development works perfectly. That exact mistake shipped
 * a store build with no backend URL.
 */
export function resolverHostUrl(): string {
  return process.env.EXPO_PUBLIC_MCP_RESOLVER_URL?.trim() || '';
}

/** Resolution clones and inspects a repository; it is not a fast request. */
const RESOLVE_TIMEOUT_MS = 120_000;

/**
 * The resolver's error vocabulary, mirrored from
 * `@mobile-agent/mcp-resolver`'s `McpResolutionErrorType`.
 */
export type CustomMcpErrorType =
  | 'UnsupportedRepository'
  | 'RepositoryFetchFailed'
  | 'NoDetectorMatched'
  | 'RuntimeNotInstalled'
  | 'EntrypointNotFound'
  | 'MissingEnvironment'
  | 'PreparationFailed'
  | 'InvalidCommand'
  | 'StartupProbeFailed'
  | 'McpHandshakeFailed'
  | 'CliNotAvailable'
  | 'ProcessSpawnFailed'
  /** Not the resolver's — the app could not reach or read the host. */
  | 'HostUnavailable';

export class CustomMcpError extends Error {
  readonly type: CustomMcpErrorType;
  readonly hints: readonly string[];

  constructor(type: CustomMcpErrorType, message: string, hints: readonly string[] = []) {
    super(message);
    this.name = 'CustomMcpError';
    this.type = type;
    this.hints = hints;
  }
}

const environmentVariableSchema = z.object({
  name: z.string().min(1),
  required: z.boolean(),
  description: z.string().optional(),
});

/**
 * The resolver's response.
 *
 * `environment` is accepted and then dropped: the resolver may echo values the
 * caller supplied, and nothing downstream of here should be able to write one
 * to disk. Unknown fields are ignored rather than rejected so a newer host
 * stays usable by an older build.
 */
const resolvedSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  workingDirectory: z.string().nullish(),
  requiredEnvironmentVariables: z.array(environmentVariableSchema).default([]),
  runtime: z.enum(['NODE', 'PYTHON', 'JVM', 'OTHER']).default('OTHER'),
  confidence: z.number().min(0).max(1).default(0),
  evidence: z.array(z.string()).default([]),
  requiresPreparation: z.boolean().default(false),
  launchDescription: z.string().nullish(),
});

const errorSchema = z.object({
  error: z.object({
    type: z.string().optional(),
    message: z.string().optional(),
    hints: z.array(z.string()).optional(),
  }),
});

const ERROR_TYPES = new Set<string>([
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
]);

/** Whether a resolver host is configured at all. */
export function hasResolverHost(): boolean {
  return resolverHostUrl().length > 0;
}

export function toDetected(parsed: z.infer<typeof resolvedSchema>): DetectedMcp {
  return {
    runtime: parsed.runtime,
    command: parsed.command,
    args: parsed.args,
    workingDirectory: parsed.workingDirectory ?? null,
    requiredEnvironmentVariables: parsed.requiredEnvironmentVariables.map((variable) => ({
      name: variable.name,
      required: variable.required,
      ...(variable.description !== undefined ? { description: variable.description } : {}),
    })),
    confidence: parsed.confidence,
    evidence: parsed.evidence,
    requiresPreparation: parsed.requiresPreparation,
    launchDescription: parsed.launchDescription ?? null,
  };
}

/** Turns a resolver error envelope into a typed failure. */
export function toError(body: unknown, status: number): CustomMcpError {
  const parsed = errorSchema.safeParse(body);
  if (parsed.success) {
    const { type, message, hints } = parsed.data.error;
    return new CustomMcpError(
      type && ERROR_TYPES.has(type) ? (type as CustomMcpErrorType) : 'HostUnavailable',
      message?.trim() || `The resolver rejected the request (HTTP ${status}).`,
      hints ?? [],
    );
  }
  return new CustomMcpError(
    'HostUnavailable',
    `The resolver returned HTTP ${status}.`,
    ['Check that EXPO_PUBLIC_MCP_RESOLVER_URL points at a running resolver host.'],
  );
}

export interface ResolveOptions {
  /** Install dependencies as part of resolving. Slow, and writes to the host. */
  prepare?: boolean;
  signal?: AbortSignal;
}

/**
 * Ask the host to resolve a source.
 *
 * Never sends environment values. The resolver reports which variables a
 * server needs; supplying them is a separate step that happens when the server
 * is started, so a secret has no reason to travel with a detection request.
 */
export async function resolveCustomMcp(
  source: CustomMcpSource,
  options: ResolveOptions = {},
): Promise<DetectedMcp> {
  if (!hasResolverHost()) {
    throw new CustomMcpError(
      'HostUnavailable',
      'No MCP resolver host is configured.',
      [
        'Set EXPO_PUBLIC_MCP_RESOLVER_URL to a host running the resolver CLI.',
        'Resolution clones a repository and runs its package manager, which a phone cannot do.',
      ],
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort);

  try {
    const response = await fetch(`${resolverHostUrl().replace(/\/+$/u, '')}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source,
        prepare: options.prepare === true,
        validate: true,
      }),
      signal: controller.signal,
    });

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) throw toError(body, response.status);

    const parsed = resolvedSchema.safeParse(body);
    if (!parsed.success) {
      throw new CustomMcpError(
        'HostUnavailable',
        'The resolver host returned a response this build cannot read.',
        [parsed.error.issues[0]?.message ?? 'Unexpected response shape.'],
      );
    }

    return toDetected(parsed.data);
  } catch (error) {
    if (error instanceof CustomMcpError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CustomMcpError(
        'HostUnavailable',
        'The resolver did not answer in time.',
        ['Cloning and inspecting a large repository can exceed two minutes.'],
      );
    }
    throw new CustomMcpError(
      'HostUnavailable',
      error instanceof Error ? error.message : 'Could not reach the resolver host.',
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
