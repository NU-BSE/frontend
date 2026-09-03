/**
 * Environment handling: which variables the server needs (names only) versus
 * which values the caller actually supplies. The resolver never sees secret
 * values.
 */

import type {
  RequiredEnvironmentVariable,
  ResolvedMcp,
} from './types';

/**
 * Builds the process environment for the MCP server.
 *
 * A base environment of safe inherited variables is kept (so PATH/HOME/etc.
 * survive), then the caller-supplied values are merged on top. Required
 * variables without a supplied value are reported, not invented.
 */
export function mergeEnvironment(
  resolved: ResolvedMcp,
  callerEnvironment: Record<string, string> | undefined,
  baseEnvironment: Record<string, string>,
): {
  environment: Record<string, string>;
  missing: RequiredEnvironmentVariable[];
} {
  const environment: Record<string, string> = { ...baseEnvironment };

  for (const [key, value] of Object.entries(callerEnvironment ?? {})) {
    if (key.length > 0 && !key.includes('\0')) {
      environment[key] = value;
    }
  }

  const missing: RequiredEnvironmentVariable[] = [];
  for (const variable of resolved.requiredEnvironmentVariables) {
    if (!variable.required) continue;
    if (variable.name in environment && environment[variable.name] !== undefined) continue;
    missing.push(variable);
  }

  return { environment, missing };
}