/**
 * Defense-in-depth structural validation, mirroring the checks performed by the
 * Kotlin resolver-core. A repository is untrusted: nothing it contains may ever
 * be assembled into a shell string.
 */

import { isAbsolute } from 'node:path';

const SHELL_METACHARACTERS = /[;&|`$<>(){}!\n\r]/;

export function isValidCommand(command: string): boolean {
  if (command.length === 0 || command.length > 1024) return false;
  if (SHELL_METACHARACTERS.test(command)) return false;
  // No quoting or substitution of any kind.
  if (command.includes("'") || command.includes('"')) return false;
  if (command.startsWith('..')) return false;

  if (isAbsolute(command)) {
    // Absolute paths are legitimate even when they contain spaces.
    return true;
  }

  // A relative command is either a single bare token (`node`, `npx`) or an
  // explicit `./<path>` into the working directory. Spaces are allowed only in
  // the explicit-relative form.
  const hasSeparator = command.includes('/') || command.includes('\\');
  if (hasSeparator) {
    if (!command.startsWith('./')) return false;
    return true;
  }
  return !/\s/u.test(command);
}

export function isValidArgs(args: string[]): boolean {
  if (args.length > 128) return false;
  return args.every(
    (arg) =>
      arg.length > 0 &&
      arg.length <= 4096 &&
      !SHELL_METACHARACTERS.test(arg) &&
      !arg.includes('\0'),
  );
}

export function validateResolved(resolved: {
  command: string;
  args: string[];
  workingDirectory: string | null;
}): void {
  if (!isValidCommand(resolved.command)) {
    throw new Error(`Invalid command: ${JSON.stringify(resolved.command)}`);
  }
  if (!isValidArgs(resolved.args)) {
    throw new Error(`Invalid args for ${JSON.stringify(resolved.command)}`);
  }
  if (resolved.workingDirectory !== null && resolved.workingDirectory.length === 0) {
    throw new Error('Working directory must be non-empty when provided');
  }
}