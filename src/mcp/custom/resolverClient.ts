/**
 * Asking the backend to translate a server for this device.
 *
 * The backend clones the repository, installs its dependencies and bundles it
 * into one JavaScript file with the stdio transport replaced by a bridge into
 * this app. That is all it does: it is a compiler, not a host. The server runs
 * here, and once its bundle is downloaded it keeps working with the backend
 * unreachable — which is what makes every MCP server local to the phone.
 *
 * This module never sends environment values. The backend reports which
 * variables a server needs; supplying them happens on-device when the server
 * starts, so a secret has no reason to travel for a translation.
 */

import { BACKEND_API_URL } from '@/ai/config';
import {
  ApiError,
  NETWORK_ERROR_STATUS,
  translateMcpServer,
  type TranslatedMcpServer,
} from '@/api/client';

import type { CustomMcpSource, DetectedMcp } from './types';

/**
 * The backend's failure vocabulary, mirrored so a refusal renders as itself.
 *
 * `RuntimeNotSupported` is the one that matters most in practice: a Python MCP
 * server is not a transient error to retry, it is a thing this device cannot
 * run, and saying so is more useful than any generic failure.
 */
export type CustomMcpErrorType =
  | 'UnsupportedRepository'
  | 'RepositoryFetchFailed'
  | 'NoDetectorMatched'
  | 'RuntimeNotSupported'
  | 'EntrypointNotFound'
  | 'PreparationFailed'
  | 'TranslationFailed'
  | 'ToolchainUnavailable'
  /** Not the backend's — the app could not reach it, or could not read it. */
  | 'HostUnavailable';

const ERROR_TYPES = new Set<string>([
  'UnsupportedRepository',
  'RepositoryFetchFailed',
  'NoDetectorMatched',
  'RuntimeNotSupported',
  'EntrypointNotFound',
  'PreparationFailed',
  'TranslationFailed',
  'ToolchainUnavailable',
]);

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

/**
 * Whether translation is available at all.
 *
 * There is nothing to configure beyond the backend the app already talks to:
 * an earlier design had a separate resolver host, which was wrong — it put an
 * MCP server somewhere other than the phone.
 */
export function hasResolverHost(): boolean {
  return BACKEND_API_URL.length > 0;
}

/** Map a backend response onto the stored shape, dropping anything else. */
export function toDetected(response: TranslatedMcpServer): DetectedMcp {
  return {
    runtime:
      response.runtime === 'NODE' ||
      response.runtime === 'PYTHON' ||
      response.runtime === 'JVM'
        ? response.runtime
        : 'OTHER',
    entrypoint: response.entrypoint ?? null,
    bundleId: response.bundleId,
    sha256: response.sha256,
    bytes: response.bytes,
    requiredEnvironmentVariables: (response.requiredEnvironment ?? []).map((variable) => ({
      name: variable.name,
      required: variable.required,
      ...(variable.description ? { description: variable.description } : {}),
    })),
    confidence: response.confidence ?? 0,
    evidence: response.evidence ?? [],
  };
}

/** Turn a transport or API failure into a typed one. */
export function toError(error: unknown): CustomMcpError {
  if (error instanceof CustomMcpError) return error;

  if (error instanceof ApiError) {
    if (error.status === NETWORK_ERROR_STATUS) {
      return new CustomMcpError('HostUnavailable', error.message, [
        'Translation needs the backend; the server itself will run on this device.',
      ]);
    }
    const code = error.code ?? '';
    return new CustomMcpError(
      ERROR_TYPES.has(code) ? (code as CustomMcpErrorType) : 'HostUnavailable',
      error.message,
      error.hints,
    );
  }

  return new CustomMcpError(
    'HostUnavailable',
    error instanceof Error ? error.message : 'Something went wrong.',
  );
}

export interface ResolveOptions {
  signal?: AbortSignal;
}

export async function resolveCustomMcp(
  source: CustomMcpSource,
  _options: ResolveOptions = {},
): Promise<DetectedMcp> {
  if (source.type !== 'repository') {
    throw new CustomMcpError(
      'UnsupportedRepository',
      'Only repository URLs can be translated.',
      ['A local directory would be a path on some other machine, not on this phone.'],
    );
  }

  if (!hasResolverHost()) {
    throw new CustomMcpError('HostUnavailable', 'No backend is configured.', [
      'Translation clones the repository and runs its package manager, which this device cannot do.',
      'The translated server still runs on this device.',
    ]);
  }

  try {
    const response = await translateMcpServer({
      url: source.url,
      ...(source.ref ? { ref: source.ref } : {}),
    });
    return toDetected(response);
  } catch (error) {
    throw toError(error);
  }
}
