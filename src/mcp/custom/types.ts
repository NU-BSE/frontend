/**
 * Custom MCP servers the user adds themselves.
 *
 * An MCP server is written to be a process — spawned, wired to stdin and
 * stdout, importing its language's standard library. Android gives an app no
 * way to exec an interpreter it did not ship, so none of that works here.
 *
 * The backend translates one instead: it clones the repository, installs its
 * dependencies and bundles it into a single JavaScript file, substituting the
 * stdio transport for a bridge into this app. The server then runs *on this
 * device*, in the app's own runtime. The backend is a compiler, not a host —
 * once a bundle is downloaded the server keeps working with the backend
 * unreachable, and no tool call is ever proxied off the phone.
 *
 * What that changes about the shape below: there is no command, no argv and no
 * working directory, because nothing is being launched. What identifies a
 * translated server is its bundle and the digest of that bundle.
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
 * A translated server, as stored on the device.
 *
 * Deliberately has no field that could hold a secret. The backend reports
 * which variables a server *needs*, by name; values live in the credential
 * vault. A shape that could carry a value would eventually carry one into
 * AsyncStorage, which is plaintext, as a side effect of rendering a summary.
 */
export interface DetectedMcp {
  runtime: CustomMcpRuntime;
  /** Path within the repository that the bundle was built from. */
  entrypoint: string | null;
  /** Content address of the translated bundle. */
  bundleId: string;
  /** Verified before the bundle is ever evaluated. */
  sha256: string;
  bytes: number;
  requiredEnvironmentVariables: CustomMcpEnvironmentVariable[];
  /** 0-1, as reported by the detector that matched. */
  confidence: number;
  /** Why the detector believes this, e.g. "package.json: bin.weather-mcp". */
  evidence: string[];
}

export type CustomMcpStatus =
  /** Added, never successfully translated. */
  | 'unresolved'
  /** Translated, but a required variable has no value yet. */
  | 'needs-configuration'
  /** Translated and fully configured. */
  | 'ready';

export interface CustomMcpServer {
  id: string;
  /** User-facing name. Defaults to the repository name. */
  label: string;
  source: CustomMcpSource;
  /** Null until a translation succeeds. */
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
  /** When the stored translation was produced. */
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
