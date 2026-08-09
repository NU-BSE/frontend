import type { Request, Response, Router } from 'express';
import express from 'express';
import Config from '../../../config/attestation.config';
import { classifyAttestation } from '@attestation/classification/classifier';
import { mintJitToken, type Signer } from './jitToken';
import {
  computeAttestationRequestHash,
  computePayloadHash,
  sha256Hex,
} from './crypto';
import {
  emptyHardwareFingerprint,
  parseAndroidHardwareFingerprint,
  type RevocationStatusProvider,
} from './hardwareFingerprint';
import {
  evaluateVelocity,
  type AsnLookup,
  type RiskProvider,
} from './velocity';
import { getRequestUserId, type NonceStore } from './nonceRoute';
import type { DeviceRegistry } from './deviceRegistry';
import type {
  AndroidAttestationSuccess,
  AttestationErrorCode,
  AttestationVerdict,
  ClassifierTrace,
  BaseAttestationResult,
  HardwareFingerprint,
  InstrumentationReport,
  IosAttestationSuccess,
  LatencySignals,
  SensitiveAction,
  TrustTier,
  VerifyRequest,
  VerifyResponse,
} from '@attestation/shared/wire';

export type PlayIntegrityDecoded = {
  requestDetails?: {
    nonce?: string;
    requestHash?: string;
    requestPackageName?: string;
    timestampMillis?: string;
  };
  appIntegrity?: {
    appRecognitionVerdict?: string;
    certificateSha256Digest?: string[];
  };
  deviceIntegrity?: {
    deviceRecognitionVerdict?: string[];
    deviceAttributes?: {
      sdkVersion?: number;
      manufacturer?: string;
      model?: string;
      osPatchLevel?: string;
    };
  };
  accountDetails?: {
    appLicensingVerdict?: string;
  };
  deviceRecall?: {
    values?: Record<string, string>;
  };
};

export interface PlayIntegrityVerifier {
  decodeIntegrityToken(token: string): Promise<PlayIntegrityDecoded>;
}

export interface AppAttestVerifier {
  verifyRegistration(input: {
    keyId: string;
    attestation: string;
    clientDataHash: string;
    teamId: string;
    bundleId: string;
    environment: 'development' | 'production';
  }): Promise<{ publicKeyPem: string; counter: number; hwBacked: boolean }>;
  verifyAssertion(input: {
    keyId: string;
    assertion: string;
    clientDataHash: string;
    publicKeyPem: string;
    lastCounter: number;
  }): Promise<{ counter: number; hwBacked: boolean }>;
}

export type RecentWebAuthnResult = {
  used: boolean;
  crossPlatform: boolean;
  aaguidTrusted: boolean;
  verifiedAtMs: number;
};

export interface RecentWebAuthnStore {
  get(userId: string): Promise<RecentWebAuthnResult | undefined>;
}

export type VerifyRouteDeps = {
  nonceStore: NonceStore;
  playIntegrityVerifier: PlayIntegrityVerifier;
  appAttestVerifier: AppAttestVerifier;
  deviceRegistry: DeviceRegistry;
  riskProvider: RiskProvider;
  asnLookup: AsnLookup;
  signer: Signer;
  revocationProvider?: RevocationStatusProvider;
  recentWebAuthn?: RecentWebAuthnStore;
  /**
   * Test-only observer used by the Detox device-lab harness to read back the
   * full decision. Never set in production (see e2eHarness.ts).
   */
  onDecision?: (record: {
    userId: string;
    deviceId: string;
    tier: TrustTier;
    reasons: string[];
    trace?: ClassifierTrace;
    atMs: number;
  }) => void;
};

type VerifiedAttestation = {
  verdict: AttestationVerdict;
  hardware: HardwareFingerprint;
  deviceId: string;
  strongIntegritySinceMs?: number;
};

type JcsModule = {
  canonicalize?: (value: unknown) => string;
  default?: (value: unknown) => string;
};

class VerificationError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      | AttestationErrorCode
      | 'BLOCKED'
      | 'PAYLOAD_BINDING_INVALID'
      | 'REQUIRES_ELEVATION',
    message: string,
    readonly retryable = false,
    readonly requiredTier?: TrustTier,
  ) {
    super(message);
    this.name = 'VerificationError';
  }
}

const tierRank: Record<TrustTier, number> = {
  BLOCKED: 0,
  RESTRICTED: 1,
  STANDARD: 2,
  ELEVATED: 3,
  HIGHEST: 4,
};

const canonicalize = async (value: unknown): Promise<string> => {
  const module = (await import('json-canonicalize')) as unknown as JcsModule;
  const fn = module.canonicalize ?? module.default;
  if (!fn) throw new Error('json-canonicalize did not expose a canonicalizer');
  return fn(value);
};

const utf8ByteLength = (value: string): number =>
  Buffer.byteLength(value, 'utf8');

const minimumTierForAction = (
  action: SensitiveAction,
): Exclude<TrustTier, 'BLOCKED'> => {
  if (action.type === 'elevatedLogin') return 'HIGHEST';
  if (action.type === 'policyChange') return 'ELEVATED';
  if (action.type === 'transfer' && action.amount >= 10_000) return 'HIGHEST';
  return 'STANDARD';
};

const isFinancial = (action: SensitiveAction): boolean =>
  action.type === 'transfer' || action.type === 'addPayee';

const assertPayloadBinding = async (
  body: VerifyRequest,
): Promise<{ canonicalJson: string; payloadHash: string }> => {
  const canonicalJson = await canonicalize(body.action);
  if (utf8ByteLength(canonicalJson) > 4 * 1024) {
    throw new VerificationError(
      400,
      'PAYLOAD_BINDING_INVALID',
      'Canonical sensitive action exceeds 4 KB',
      false,
    );
  }
  if (canonicalJson !== body.canonicalJson) {
    throw new VerificationError(
      400,
      'PAYLOAD_BINDING_INVALID',
      'canonicalJson does not match the canonical form of action',
      false,
    );
  }
  return {
    canonicalJson,
    payloadHash: computePayloadHash(canonicalJson),
  };
};

const assertAttestationSuccess = (
  attestation: BaseAttestationResult,
): AndroidAttestationSuccess | IosAttestationSuccess => {
  if (!attestation.ok) {
    throw new VerificationError(
      400,
      attestation.code,
      attestation.details ?? 'Client attestation failed before verification',
      attestation.retryable,
    );
  }
  return attestation;
};

const assertPlatformConsistency = (
  attestation: AndroidAttestationSuccess | IosAttestationSuccess,
  report: InstrumentationReport,
): void => {
  if (attestation.platform !== report.platform) {
    throw new VerificationError(
      400,
      'UNKNOWN',
      'Attestation platform does not match instrumentation platform',
      false,
    );
  }
};

const configuredAndroidCerts = (): Set<string> =>
  new Set(
    Config.android.expectedCertificateSha256.map((value) =>
      value.toLowerCase(),
    ),
  );

const normalizeAndroidVerdict = (
  decoded: PlayIntegrityDecoded,
  expectedRequestHash: string,
): AttestationVerdict => {
  const verdicts = decoded.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  const requestHash =
    decoded.requestDetails?.requestHash ?? decoded.requestDetails?.nonce;
  const expectedCerts = configuredAndroidCerts();
  const presentedCerts = (
    decoded.appIntegrity?.certificateSha256Digest ?? []
  ).map((value) => value.toLowerCase());
  const certificateOk =
    expectedCerts.size === 0 ||
    presentedCerts.some((cert) => expectedCerts.has(cert));
  const packageOk =
    decoded.requestDetails?.requestPackageName === Config.android.packageName;
  const appRecognized =
    decoded.appIntegrity?.appRecognitionVerdict === 'PLAY_RECOGNIZED';
  const licensed =
    decoded.accountDetails?.appLicensingVerdict === 'LICENSED';
  const requestHashOk = requestHash === expectedRequestHash;
  const deviceIntegrity =
    verdicts.includes('MEETS_DEVICE_INTEGRITY') ||
    verdicts.includes('MEETS_STRONG_INTEGRITY');
  const strongIntegrity = verdicts.includes('MEETS_STRONG_INTEGRITY');

  return {
    ok:
      requestHashOk &&
      packageOk &&
      certificateOk &&
      appRecognized &&
      licensed &&
      deviceIntegrity,
    platform: 'android',
    signals: {
      requestHashOk,
      packageOk,
      certificateOk,
      appRecognized,
      licensed,
      deviceIntegrity,
      strongIntegrity,
      sdkVersion: decoded.deviceIntegrity?.deviceAttributes?.sdkVersion,
    },
    rawVerdict: {
      appRecognitionVerdict: decoded.appIntegrity?.appRecognitionVerdict,
      deviceRecognitionVerdict: verdicts,
      appLicensingVerdict: decoded.accountDetails?.appLicensingVerdict,
      certificateDigestMatched: certificateOk,
      sdkVersion: decoded.deviceIntegrity?.deviceAttributes?.sdkVersion,
    },
    hwBacked: deviceIntegrity,
    strongIntegrity,
    firstSeen: false,
  };
};

const androidDeviceId = (decoded: PlayIntegrityDecoded): string => {
  const recallHandle = decoded.deviceRecall?.values?.deviceHandle;
  if (recallHandle) return `pi:${sha256Hex(recallHandle)}`;
  return `pi:${sha256Hex(
    [
      decoded.requestDetails?.requestPackageName,
      decoded.deviceIntegrity?.deviceAttributes?.manufacturer,
      decoded.deviceIntegrity?.deviceAttributes?.model,
      decoded.deviceIntegrity?.deviceAttributes?.sdkVersion,
      ...(decoded.appIntegrity?.certificateSha256Digest ?? []),
    ].join(':'),
  )}`;
};

const androidSoftwareModel = (
  report: InstrumentationReport,
): string | undefined => {
  const signal = report.signals.androidSignals;
  if (
    signal &&
    typeof signal === 'object' &&
    'ok' in signal &&
    (signal as { ok?: unknown }).ok === true
  ) {
    return (signal as { value?: { model?: string } }).value?.model;
  }
  return undefined;
};

const ensureDeviceUserBinding = (
  existing: { userId: string } | undefined,
  userId: string,
): void => {
  if (existing && existing.userId !== userId) {
    throw new VerificationError(
      403,
      'UNKNOWN',
      'Device is already bound to a different user',
      false,
    );
  }
};

const verifyAndroid = async (
  deps: VerifyRouteDeps,
  attestation: AndroidAttestationSuccess,
  input: {
    nonce: string;
    payloadHash: string;
    userId: string;
    instrumentationReport: InstrumentationReport;
  },
): Promise<VerifiedAttestation> => {
  const decoded = await deps.playIntegrityVerifier.decodeIntegrityToken(
    attestation.token,
  );
  const expectedRequestHash = computeAttestationRequestHash(
    input.nonce,
    input.payloadHash,
  );
  const verdict = normalizeAndroidVerdict(decoded, expectedRequestHash);
  const deviceId = androidDeviceId(decoded);
  const existing = await deps.deviceRegistry.get(deviceId);
  ensureDeviceUserBinding(existing, input.userId);
  verdict.firstSeen = !existing;

  const now = Date.now();
  const strongIntegritySinceMs = verdict.strongIntegrity
    ? existing?.strongIntegritySinceMs ?? now
    : undefined;
  await deps.deviceRegistry.upsert({
    deviceId,
    userId: input.userId,
    platform: 'android',
    firstSeenAtMs: existing?.firstSeenAtMs ?? now,
    ...(strongIntegritySinceMs ? { strongIntegritySinceMs } : {}),
    ...(decoded.deviceIntegrity?.deviceAttributes?.model
      ? { modelFamily: decoded.deviceIntegrity.deviceAttributes.model }
      : {}),
  });

  const softwareReportedModel = androidSoftwareModel(input.instrumentationReport);
  const hardwareInput = {
    nonce: input.nonce,
    payloadHash: input.payloadHash,
    ...(attestation.hardwareKeyAttestation?.certificateChainBase64
      ? {
          certificateChainBase64:
            attestation.hardwareKeyAttestation.certificateChainBase64,
        }
      : {}),
    ...(softwareReportedModel ? { softwareReportedModel } : {}),
    ...(decoded.deviceIntegrity?.deviceAttributes?.model
      ? {
          playIntegrityModelFamily:
            decoded.deviceIntegrity.deviceAttributes.model,
        }
      : {}),
    ...(decoded.deviceIntegrity?.deviceAttributes?.osPatchLevel
      ? {
          osPatchLevel: decoded.deviceIntegrity.deviceAttributes.osPatchLevel,
        }
      : {}),
  };
  const parsedHardware = await parseAndroidHardwareFingerprint(hardwareInput, {
    ...(deps.revocationProvider
      ? { revocationProvider: deps.revocationProvider }
      : {}),
  });
  const hardware: HardwareFingerprint = attestation.hardwareKeyAttestation?.certificateChainBase64
    ?.length
    ? parsedHardware
    : {
        ...parsedHardware,
        hwBacked: verdict.hwBacked,
        strongBox: verdict.strongIntegrity,
        verifiedBoot: verdict.hwBacked,
        rootOfTrust: verdict.hwBacked ? 'VERIFIED' as const : 'FAILED' as const,
      };

  return {
    verdict,
    hardware,
    deviceId,
    ...(strongIntegritySinceMs ? { strongIntegritySinceMs } : {}),
  };
};

const verifyIos = async (
  deps: VerifyRouteDeps,
  attestation: IosAttestationSuccess,
  input: { nonce: string; payloadHash: string; userId: string },
): Promise<VerifiedAttestation> => {
  const clientDataHash = computeAttestationRequestHash(
    input.nonce,
    input.payloadHash,
  );
  const deviceId = `appattest:${attestation.keyId}`;
  const existing = await deps.deviceRegistry.get(deviceId);
  ensureDeviceUserBinding(existing, input.userId);

  if (attestation.attestation) {
    const registration = await deps.appAttestVerifier.verifyRegistration({
      keyId: attestation.keyId,
      attestation: attestation.attestation,
      clientDataHash,
      teamId: Config.ios.teamId,
      bundleId: Config.ios.bundleId,
      environment: Config.ios.appAttestEnvironment,
    });
    const now = Date.now();
    const strongIntegritySinceMs = existing?.strongIntegritySinceMs ?? now;
    await deps.deviceRegistry.upsert({
      deviceId,
      userId: input.userId,
      platform: 'ios',
      keyId: attestation.keyId,
      publicKeyPem: registration.publicKeyPem,
      lastCounter: registration.counter,
      firstSeenAtMs: existing?.firstSeenAtMs ?? now,
      strongIntegritySinceMs,
    });
    return {
      deviceId,
      strongIntegritySinceMs,
      hardware: {
        ...emptyHardwareFingerprint('ios-app-attest'),
        hwBacked: registration.hwBacked,
        verifiedBoot: true,
        osPatchLevelAgeDays: 0,
        rootOfTrust: 'VERIFIED',
      },
      verdict: {
        ok: true,
        platform: 'ios',
        signals: { registration: true, counter: registration.counter },
        rawVerdict: { registration: true },
        hwBacked: registration.hwBacked,
        strongIntegrity: registration.hwBacked,
        firstSeen: !existing,
      },
    };
  }

  if (!attestation.assertion) {
    throw new VerificationError(
      400,
      'ASSERTION_FAILED',
      'App Attest assertion is required after registration',
      false,
    );
  }
  if (!existing?.publicKeyPem) {
    throw new VerificationError(
      403,
      'ASSERTION_FAILED',
      'App Attest key is not registered',
      false,
    );
  }

  const assertion = await deps.appAttestVerifier.verifyAssertion({
    keyId: attestation.keyId,
    assertion: attestation.assertion,
    clientDataHash,
    publicKeyPem: existing.publicKeyPem,
    lastCounter: existing.lastCounter ?? 0,
  });
  if (assertion.counter <= (existing.lastCounter ?? 0)) {
    throw new VerificationError(
      403,
      'ASSERTION_FAILED',
      'App Attest counter replay detected',
      false,
    );
  }
  await deps.deviceRegistry.updateCounter(deviceId, assertion.counter);

  return {
    deviceId,
    ...(existing.strongIntegritySinceMs
      ? { strongIntegritySinceMs: existing.strongIntegritySinceMs }
      : {}),
    hardware: {
      ...emptyHardwareFingerprint('ios-app-attest'),
      hwBacked: assertion.hwBacked,
      verifiedBoot: true,
      osPatchLevelAgeDays: 0,
      rootOfTrust: 'VERIFIED',
    },
    verdict: {
      ok: true,
      platform: 'ios',
      signals: { assertion: true, counter: assertion.counter },
      rawVerdict: { assertion: true },
      hwBacked: assertion.hwBacked,
      strongIntegrity: assertion.hwBacked,
      firstSeen: false,
    },
  };
};

const verifyAttestation = async (
  deps: VerifyRouteDeps,
  attestation: AndroidAttestationSuccess | IosAttestationSuccess,
  input: {
    nonce: string;
    payloadHash: string;
    userId: string;
    instrumentationReport: InstrumentationReport;
  },
): Promise<VerifiedAttestation> => {
  if (attestation.platform === 'android') {
    return verifyAndroid(deps, attestation, input);
  }
  return verifyIos(deps, attestation, {
    nonce: input.nonce,
    payloadHash: input.payloadHash,
    userId: input.userId,
  });
};

const reject = (
  res: Response,
  status: number,
  body: VerifyResponse,
): void => {
  res.status(status).json(body);
};

const rejectVerificationError = (
  res: Response,
  error: VerificationError,
): void => {
  reject(res, error.status, {
    ok: false,
    code: error.code,
    retryable: error.retryable,
    ...(error.requiredTier ? { requiredTier: error.requiredTier } : {}),
    message: error.message,
  });
};

export const createVerifyRouter = (deps: VerifyRouteDeps): Router => {
  const router = express.Router();

  router.post('/attest/verify', async (req: Request, res: Response) => {
    try {
      const userId = getRequestUserId(req);
      const body = req.body as VerifyRequest;
      const attestation = assertAttestationSuccess(body.attestation);
      assertPlatformConsistency(attestation, body.instrumentationReport);
      const { payloadHash } = await assertPayloadBinding(body);

      const nonceRecord = await deps.nonceStore.consume(body.nonce, userId);
      if (!nonceRecord) {
        throw new VerificationError(
          400,
          'NONCE_REJECTED',
          'Nonce expired, missing, already used, or not bound to user',
          true,
        );
      }

      const verified = await verifyAttestation(deps, attestation, {
        nonce: body.nonce,
        payloadHash,
        userId,
        instrumentationReport: body.instrumentationReport,
      });

      const now = Date.now();
      const requestIp = req.ip ?? '';
      const asn = await deps.asnLookup.lookup(requestIp);
      const velocity = await evaluateVelocity(
        deps.riskProvider,
        verified.deviceId,
        {
          nowMs: now,
          nonce: body.nonce,
          ip: requestIp,
          asn,
          payloadHash,
          firstSeen: verified.verdict.firstSeen,
        },
      );
      const recentWebAuthn = await deps.recentWebAuthn?.get(userId);
      const latency: LatencySignals =
        req.attestationLatency ?? {
          rttMs: now - nonceRecord.serverIssuedAt,
          nonceAgeMs: now - nonceRecord.serverIssuedAt,
          clockSkewMs: nonceRecord.clientTs - nonceRecord.serverIssuedAt,
          latencyAnomaly: false,
        };

      const classifierInput = {
        verdict: verified.verdict,
        instrumentationReport: body.instrumentationReport,
        velocity,
        hardware: verified.hardware,
        latency,
        action: body.action,
        ...(recentWebAuthn ? { webauthn: recentWebAuthn } : {}),
        ...(verified.strongIntegritySinceMs
          ? { strongIntegritySinceMs: verified.strongIntegritySinceMs }
          : {}),
      };
      const decision = classifyAttestation(classifierInput);

      if (deps.onDecision) {
        // Classified a second time with the trace forced on, so enabling the
        // device-lab observer can never change what the client is told.
        const traced = classifyAttestation(classifierInput, { debug: true });
        deps.onDecision({
          userId,
          deviceId: verified.deviceId,
          tier: traced.tier,
          reasons: traced.reasons,
          atMs: now,
          ...(traced.trace ? { trace: traced.trace } : {}),
        });
      }

      if (decision.tier === 'BLOCKED') {
        reject(res, 403, {
          ok: false,
          code: 'BLOCKED',
          retryable: false,
          message: decision.reasons.join('; '),
          ...(decision.trace ? { classifierTrace: decision.trace } : {}),
        });
        return;
      }

      const requiredTier = minimumTierForAction(body.action);
      if (
        tierRank[decision.tier] < tierRank[requiredTier] ||
        (decision.tier === 'RESTRICTED' && isFinancial(body.action))
      ) {
        reject(res, 403, {
          ok: false,
          code: 'REQUIRES_ELEVATION',
          requiredTier,
          retryable: true,
          message: `Action requires ${requiredTier} trust tier`,
          ...(decision.trace ? { classifierTrace: decision.trace } : {}),
        });
        return;
      }

      const { token, expiresAt } = await mintJitToken(deps.signer, {
        userId,
        tier: decision.tier,
        payloadHash,
        deviceId: verified.deviceId,
      });

      res.json({
        ok: true,
        accessToken: token,
        tier: decision.tier,
        expiresAt,
        ...(decision.trace ? { classifierTrace: decision.trace } : {}),
      } satisfies VerifyResponse);
    } catch (error) {
      if (error instanceof VerificationError) {
        rejectVerificationError(res, error);
        return;
      }
      reject(res, 500, {
        ok: false,
        code: 'UNKNOWN',
        retryable: true,
        message:
          Config.env === 'development' && error instanceof Error
            ? error.message
            : 'Attestation verification service failed',
      });
    }
  });

  return router;
};
