import { attestSession } from './baseAttestation';
import { runInstrumentationChecks } from './instrumentation';
import { requestNonce } from './nonce';
import { bindPayload } from './payloadBinding';
import { createAndroidHardwareKeyAttestation } from './hardwareKey';
import { setLastClassifierTrace } from './debugTrace';
import { serverBaseUrl } from './runtimeConfig';
import { userHeaders } from './userSession';
import type {
  AttestationTelemetry,
  BoundPayload,
  SensitiveAction,
  VerifyRequest,
  VerifyResponse,
} from '@attestation/shared/wire';

export type AttestationProgress =
  | 'probing'
  | 'attesting'
  | 'verifying'
  | 'elevating'
  | 'running';

export class AttestationFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requiredTier: string | undefined;
  readonly classifierTrace: unknown;

  constructor(input: {
    code: string;
    message: string;
    retryable: boolean;
    requiredTier?: string;
    classifierTrace?: unknown;
  }) {
    super(input.message);
    this.name = 'AttestationFailure';
    this.code = input.code;
    this.retryable = input.retryable;
    this.requiredTier = input.requiredTier;
    this.classifierTrace = input.classifierTrace;
  }
}

const VERIFY_TIMEOUT_MS = 15_000;

export type ExecuteAttestedOptions = {
  telemetry?: AttestationTelemetry;
  onProgress?: (progress: AttestationProgress) => void;
  webauthn?: {
    challengeId: string;
    response: unknown;
  };
  prepareWebAuthn?: (input: {
    nonce: string;
    bound: BoundPayload;
  }) => Promise<{
    challengeId: string;
    response: unknown;
  }>;
};

export const executeAttested = async <T>(
  action: SensitiveAction,
  apiCall: (accessToken: string) => Promise<T>,
  options: ExecuteAttestedOptions = {},
): Promise<T> => {
  options.onProgress?.('probing');
  const instrumentationReport = await runInstrumentationChecks();
  const nonce = await requestNonce();
  const bound = await bindPayload(action);
  const preparedWebAuthn = options.prepareWebAuthn
    ? await options.prepareWebAuthn({ nonce: nonce.nonce, bound })
    : undefined;

  options.onProgress?.('attesting');
  const attestation = await attestSession(
    {
      nonce: nonce.nonce,
      payloadHash: bound.payloadHash,
    },
    options.telemetry,
  );

  if (!attestation.ok) {
    throw new AttestationFailure({
      code: attestation.code,
      message: attestation.details ?? 'Device attestation failed',
      retryable: attestation.retryable,
    });
  }
  const hardwareKeyAttestation =
    action.type === 'transfer' && action.amount >= 10_000
      ? await createAndroidHardwareKeyAttestation({
          nonce: nonce.nonce,
          payloadHash: bound.payloadHash,
        })
      : undefined;
  const boundAttestation =
    attestation.ok && attestation.platform === 'android' && hardwareKeyAttestation
      ? { ...attestation, hardwareKeyAttestation }
      : attestation;

  options.onProgress?.('verifying');
  const webauthn = options.webauthn ?? preparedWebAuthn;
  const verifyRequest: VerifyRequest = {
    action,
    canonicalJson: bound.canonicalJson,
    nonce: nonce.nonce,
    attestation: boundAttestation,
    instrumentationReport,
    ...(webauthn ? { webauthn } : {}),
  };
  const verifyController = new AbortController();
  const verifyTimeout = setTimeout(
    () => verifyController.abort(),
    VERIFY_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetch(`${serverBaseUrl}/attest/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...userHeaders() },
      body: JSON.stringify(verifyRequest),
      signal: verifyController.signal,
    });
  } catch (error) {
    if (verifyController.signal.aborted) {
      throw new AttestationFailure({
        code: 'VERIFY_TIMEOUT',
        message: `Attestation verification timed out after ${VERIFY_TIMEOUT_MS}ms`,
        retryable: true,
      });
    }
    throw error;
  } finally {
    clearTimeout(verifyTimeout);
  }

  // A rejection is a normal, JSON-shaped answer: /attest/verify replies 403 with
  // { ok: false, code: 'BLOCKED' | 'REQUIRES_ELEVATION', classifierTrace }.
  // Throwing on !response.ok before reading the body would hide the code, the
  // required tier and the trace behind a generic HTTP error.
  const isJson = (response.headers.get('content-type') ?? '').includes(
    'application/json',
  );
  if (!response.ok && !isJson) {
    throw new AttestationFailure({
      code: 'VERIFY_HTTP_ERROR',
      message: `Attestation verification failed with HTTP ${response.status}`,
      retryable: response.status >= 500,
    });
  }

  let verify: VerifyResponse;
  try {
    verify = (await response.json()) as VerifyResponse;
  } catch {
    throw new AttestationFailure({
      code: 'VERIFY_HTTP_ERROR',
      message: `Attestation verification returned an unreadable body (HTTP ${response.status})`,
      retryable: response.status >= 500,
    });
  }
  setLastClassifierTrace(verify.classifierTrace);
  if (!verify.ok) {
    throw new AttestationFailure({
      code: verify.code,
      message: verify.message ?? 'Attestation rejected',
      retryable: verify.retryable,
      ...(verify.requiredTier ? { requiredTier: verify.requiredTier } : {}),
      ...(verify.classifierTrace
        ? { classifierTrace: verify.classifierTrace }
        : {}),
    });
  }

  options.onProgress?.('running');
  return apiCall(verify.accessToken);
};
