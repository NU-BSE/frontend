/**
 * Custom MCP servers the user adds themselves.
 *
 * The detection and parsing behind this lives in `packages/mcp-resolver` and
 * the Kotlin `resolver/` CLI: given a git repository or a local directory, it
 * works out the runtime, the entrypoint, the command line and which
 * environment variables the server needs, and reports that as a `ResolvedMcp`.
 *
 * None of that can run on the phone. The resolver clones repositories, runs
 * package managers and spawns the server over stdio — `node:child_process`,
 * `node:fs`, a JVM. Hermes has none of them. So the app is the *client* of a
 * resolver host, and this module holds the part that is device-side: what the
 * user asked for, what came back, and what they still need to supply.
 *
 * These types deliberately mirror `@mobile-agent/mcp-resolver` rather than
 * importing it. Importing that package for its types alone would be fine, but
 * a single accidental value import — one `import { ... }` instead of `import
 * type { ... }` during a later edit — pulls `node:child_process` into the
 * Metro bundle and breaks the app at startup, with a stack that points at the
 * bundler rather than at the import. `verify:custom-mcp` asserts the shapes
 * still agree, so the duplication cannot drift silently.
 */

/** What the user pointed us at. */
export type CustomMcpSource =
  | {
      type: 'repository';
      url: string;
      /** Branch, tag or commit. Absent means the repository default. */
      ref?: string;
    }
  | {
      type: 'directory';
      /** Absolute path on the resolver host, not on the phone. */
      path: string;
    };

/** Runtime ecosystem the resolver detected. */
export type CustomMcpRuntime = 'NODE' | 'PYTHON' | 'JVM' | 'OTHER';

/** A variable the server needs. Names and descriptions only — never values. */
export interface CustomMcpEnvironmentVariable {
  name: string;
  required: boolean;
  description?: string;
}

/**
 * What the resolver reported, as stored on the device.
 *
 * This is `ResolvedMcp` with `environment` removed. That field can carry real
 * values, and a resolver host that echoes back a variable the caller supplied
 * would otherwise have its value written into AsyncStorage as a side effect of
 * showing a summary screen. Secrets belong in the credential vault and nowhere
 * else, so the shape that reaches storage cannot express one.
 */
export interface DetectedMcp {
  runtime: CustomMcpRuntime;
  command: string;
  args: string[];
  workingDirectory: string | null;
  requiredEnvironmentVariables: CustomMcpEnvironmentVariable[];
  /** 0–1, as reported by the detector that matched. */
  confidence: number;
  /** Why the detector believes this, e.g. "package.json: bin.mcp-server". */
  evidence: string[];
  /** Dependencies must be installed before the server will start. */
  requiresPreparation: boolean;
  /** Human-readable command summary, when the resolver produced one. */
  launchDescription: string | null;
}

export type CustomMcpStatus =
  /** Added, never successfully resolved. */
  | 'unresolved'
  /** Resolved, but a required variable has no value yet. */
  | 'needs-configuration'
  /** Resolved and fully configured. */
  | 'ready';

export interface CustomMcpServer {
  id: string;
  /** User-facing name. Defaults to the repository name. */
  label: string;
  source: CustomMcpSource;
  /** Null until a resolve succeeds. */
  detected: DetectedMcp | null;
  /**
   * Names of variables the user has supplied a value for. The values
   * themselves live in the credential vault under `credentialReference`;
   * this list exists so the UI can show what is still missing without
   * reading secrets to find out.
   */
  configuredEnvironment: string[];
  /** Vault pointer. A reference, never a credential. */
  credentialReference: string;
  addedAt: number;
  /** When the stored detection was produced. */
  resolvedAt: number | null;
}

/**
 * Which required variables still have no value.
 *
 * Optional variables are excluded on purpose: the resolver reports them so a
 * user *can* set them, not so the server is held back until they do.
 */
export function missingEnvironment(server: CustomMcpServer): CustomMcpEnvironmentVariable[] {
  if (!server.detected) return [];
  const configured = new Set(server.configuredEnvironment);
  return server.detected.requiredEnvironmentVariables.filter(
    (variable) => variable.required && !configured.has(variable.name),
  );
}

export function statusOf(server: CustomMcpServer): CustomMcpStatus {
  if (!server.detected) return 'unresolved';
  return missingEnvironment(server).length > 0 ? 'needs-configuration' : 'ready';
}

/**
 * A readable name for a source, used as the default label.
 *
 * Repository URLs are the common case and their last path segment is the
 * name a user recognises; `.git` is stripped because `example-mcp.git` is not
 * what anyone calls it.
 */
export function defaultLabel(source: CustomMcpSource): string {
  if (source.type === 'directory') {
    const segments = source.path.split(/[\\/]/u).filter(Boolean);
    return segments[segments.length - 1] ?? source.path;
  }

  const withoutQuery = source.url.split(/[?#]/u)[0] ?? source.url;
  const segments = withoutQuery.replace(/\/+$/u, '').split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? source.url;
  return last.replace(/\.git$/u, '') || source.url;
}
