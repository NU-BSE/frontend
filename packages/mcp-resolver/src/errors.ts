/**
 * Structured resolver failures. Messages state what failed, what was detected,
 * what command was attempted and what the user can do — never secret values.
 */

export type McpResolutionErrorType =
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
  | 'ProcessSpawnFailed';

export class McpResolutionError extends Error {
  readonly type: McpResolutionErrorType;
  readonly hints: readonly string[];

  constructor(type: McpResolutionErrorType, message: string, hints: readonly string[] = [], cause?: unknown) {
    super(message, { cause });
    this.name = 'McpResolutionError';
    this.type = type;
    this.hints = hints;
  }
}

export function missingEnvironmentError(variable: RequiredEnvironmentVariable): McpResolutionError {
  return new McpResolutionError(
    'MissingEnvironment',
    `Missing required environment variable: ${variable.name}` +
      (variable.description ? `. ${variable.description}` : ''),
    [
      `Provide a value for ${variable.name} in the environment supplied to createMcpToolset().`,
      ...(variable.description ? [variable.description] : []),
    ],
  );
}

interface RequiredEnvironmentVariable {
  name: string;
  required: boolean;
  description?: string;
}