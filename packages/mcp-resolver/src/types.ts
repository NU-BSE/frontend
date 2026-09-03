/**
 * Core data model for the MCP server resolver.
 *
 * The resolver only answers "how do I run this MCP server over stdio?". It has
 * no knowledge of agents or tool registries — that separation lives in
 * `toolset.ts`.
 */

/** What the resolver is asked to resolve. */
export type McpSource =
  | {
      type: 'repository';
      url: string;
      ref?: string;
    }
  | {
      type: 'directory';
      /** Absolute local path. Never modified by the resolver. */
      path: string;
    };

/** Runtime ecosystem the project belongs to. */
export type McpRuntime = 'NODE' | 'PYTHON' | 'JVM' | 'OTHER';

/** A variable the server may need at runtime (name only — never a value). */
export interface RequiredEnvironmentVariable {
  name: string;
  required: boolean;
  description?: string;
}

/**
 * The unified, structured description of how to start the MCP server.
 *
 * `command`/`args` are strictly separated — never a shell string. `environment`
 * holds actual values only when the caller supplied them; the resolver reports
 * required variable *names* in [requiredEnvironmentVariables].
 */
export interface ResolvedMcp {
  command: string;
  args: string[];
  environment: Record<string, string>;
  workingDirectory: string | null;
  requiredEnvironmentVariables: RequiredEnvironmentVariable[];
  runtime: McpRuntime;
  confidence: number;
  evidence: string[];
  requiresPreparation: boolean;
  launchDescription: string | null;
}

/** A tool definition as published by an MCP server. */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/** Structured resolver outcome. */
export interface ResolutionResult {
  resolved: ResolvedMcp;
  /** Required variables that still have no value supplied by the caller. */
  missingEnvironment: RequiredEnvironmentVariable[];
}