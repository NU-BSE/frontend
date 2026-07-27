import { readFileSync } from 'node:fs';
import Config from '../../../config/attestation.config';
import { differenceInCalendarDays } from './time';
import { computeAttestationRequestHash } from './crypto';
import {
  KeyAttestationError,
  parseTrustedRootsPem,
  verifyAndroidKeyAttestationChain,
  type KeyAttestationPolicy,
  type KeyAttestationVerification,
  type RevocationStatusProvider,
  type TrustedRoot,
} from './androidKeyAttestation';
import type { HardwareFingerprint } from '@attestation/shared/wire';

export type { RevocationStatusProvider } from './androidKeyAttestation';

export type AndroidHardwareAttestationInput = {
  certificateChainBase64?: string[];
  nonce: string;
  payloadHash: string;
  softwareReportedModel?: string;
  playIntegrityModelFamily?: string;
  /** `deviceAttributes.osPatchLevel` from the Play Integrity verdict (YYYY-MM-DD). */
  osPatchLevel?: string;
};

export type AndroidHardwareAttestationDeps = {
  revocationProvider?: RevocationStatusProvider;
  trustedRoots?: TrustedRoot[];
  policy?: Partial<KeyAttestationPolicy>;
  nowMs?: number;
};

export class GoogleRevocationStatusProvider implements RevocationStatusProvider {
  private cache?: { loadedAtMs: number; revoked: Set<string> };

  constructor(
    private readonly statusUrl = Config.android.keyAttestation
      .revocationStatusUrl,
    private readonly ttlMs = 60 * 60 * 1000,
  ) {}

  async isRevoked(serialNumberHex: string): Promise<boolean> {
    const now = Date.now();
    if (!this.cache || now - this.cache.loadedAtMs > this.ttlMs) {
      const response = await fetch(this.statusUrl);
      if (!response.ok) {
        throw new Error(
          `Google attestation status feed returned HTTP ${response.status}`,
        );
      }
      const json = (await response.json()) as {
        entries?: Record<string, { status?: string }>;
      };
      this.cache = {
        loadedAtMs: now,
        revoked: new Set(
          Object.entries(json.entries ?? {})
            // The feed lists both REVOKED and SUSPENDED serials; neither may be
            // trusted for a high-value action.
            .filter(([, entry]) => entry.status !== undefined)
            .map(([serial]) => serial.replace(/^0+/u, '').toLowerCase()),
        ),
      };
    }
    return this.cache.revoked.has(
      serialNumberHex.replace(/^0+/u, '').toLowerCase(),
    );
  }
}

let cachedTrustedRoots: TrustedRoot[] | undefined;

/**
 * Loads the pinned Google Hardware Attestation Roots from configuration. The
 * roots must come from the operator (env PEM or a bundle file) — a root that
 * merely arrives inside the device-supplied chain proves nothing.
 */
export const loadTrustedAttestationRoots = (): TrustedRoot[] => {
  if (cachedTrustedRoots) return cachedTrustedRoots;
  const { trustedRootsPem, trustedRootsPath } = Config.android.keyAttestation;
  const pem =
    trustedRootsPem ??
    (trustedRootsPath ? readFileSync(trustedRootsPath, 'utf8') : undefined);
  cachedTrustedRoots = pem ? parseTrustedRootsPem(pem) : [];
  return cachedTrustedRoots;
};

/** Test seam: drops the memoised trust store. */
export const resetTrustedAttestationRootsCache = (): void => {
  cachedTrustedRoots = undefined;
};

const keyAttestationPolicy = (
  overrides?: Partial<KeyAttestationPolicy>,
): KeyAttestationPolicy => ({
  requireTrustedRoot: Config.android.keyAttestation.requireTrustedRoot,
  requireStrongBox: Config.android.keyAttestation.requireStrongBox,
  allowSoftwareSecurityLevel:
    Config.android.keyAttestation.allowSoftwareSecurityLevel,
  ...overrides,
});

const patchLevelAgeDays = (
  isoDate: string | undefined,
  nowMs: number,
): number => {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/u.test(isoDate)) return 9999;
  return differenceInCalendarDays(
    new Date(nowMs),
    new Date(`${isoDate}T00:00:00Z`),
  );
};

const modelsAgree = (a: string, b: string): boolean => {
  const left = a.toLowerCase().replace(/\s+/gu, '');
  const right = b.toLowerCase().replace(/\s+/gu, '');
  return left.includes(right) || right.includes(left);
};

export const emptyHardwareFingerprint = (
  platformModel = 'unknown',
): HardwareFingerprint => ({
  hwBacked: false,
  strongBox: false,
  verifiedBoot: false,
  osPatchLevelAgeDays: 9999,
  modelFamily: platformModel,
  softwareReportedModel: platformModel,
  discrepancy: false,
});

const fingerprintFromVerification = (
  verification: KeyAttestationVerification,
  input: AndroidHardwareAttestationInput,
  nowMs: number,
): HardwareFingerprint => {
  const softwareReportedModel = input.softwareReportedModel ?? 'unknown';
  const attestedModel =
    verification.attestedModel ?? input.playIntegrityModelFamily ?? 'unknown';
  const discrepancy =
    attestedModel !== 'unknown' &&
    softwareReportedModel !== 'unknown' &&
    !modelsAgree(softwareReportedModel, attestedModel);

  const verifiedBootState = verification.verifiedBootState;
  const patchIsoDate = verification.osPatchLevelDate ?? input.osPatchLevel;

  return {
    // The chain verified: signatures link up, it terminates in a pinned root
    // and the attestation challenge matched byte-for-byte.
    hwBacked: verification.securityLevel !== 'SOFTWARE',
    strongBox: verification.strongBox,
    verifiedBoot: verifiedBootState === 'VERIFIED',
    osPatchLevelAgeDays: patchLevelAgeDays(patchIsoDate, nowMs),
    modelFamily: attestedModel,
    softwareReportedModel,
    discrepancy,
    ...(verifiedBootState ? { rootOfTrust: verifiedBootState } : {}),
    securityLevel: verification.securityLevel,
    teeFallback: verification.teeFallback,
    chainVerified: true,
    rootTrusted: verification.rootTrusted,
    ...(verification.osVersionText
      ? { osVersion: verification.osVersionText }
      : {}),
    ...(verification.deviceLocked !== undefined
      ? { deviceLocked: verification.deviceLocked }
      : {}),
    ...(verification.warnings.length > 0
      ? { warnings: verification.warnings }
      : {}),
  };
};

/**
 * Verifies the Android Key Attestation chain the client submitted for a
 * high-value action and folds the result into the classifier's
 * `HardwareFingerprint`.
 *
 * A chain that fails verification never yields a trusted fingerprint: the
 * result carries `rootOfTrust: 'FAILED'` plus the reason, which blocks
 * financial actions in the classifier.
 */
export const parseAndroidHardwareFingerprint = async (
  input: AndroidHardwareAttestationInput,
  deps: AndroidHardwareAttestationDeps | RevocationStatusProvider = {},
): Promise<HardwareFingerprint> => {
  const options: AndroidHardwareAttestationDeps =
    'isRevoked' in deps ? { revocationProvider: deps } : deps;
  const nowMs = options.nowMs ?? Date.now();
  const chain = input.certificateChainBase64 ?? [];
  const softwareReportedModel = input.softwareReportedModel ?? 'unknown';
  const playIntegrityModel = input.playIntegrityModelFamily;

  if (chain.length === 0) {
    // No hardware key chain for this action: the caller falls back to the Play
    // Integrity verdict for hardware signals.
    return {
      ...emptyHardwareFingerprint(),
      modelFamily: playIntegrityModel ?? softwareReportedModel,
      softwareReportedModel,
      osPatchLevelAgeDays: patchLevelAgeDays(input.osPatchLevel, nowMs),
      discrepancy:
        playIntegrityModel !== undefined &&
        softwareReportedModel !== 'unknown' &&
        !modelsAgree(softwareReportedModel, playIntegrityModel),
      chainVerified: false,
    };
  }

  try {
    const verification = await verifyAndroidKeyAttestationChain({
      certificateChainBase64: chain,
      expectedChallenge: Buffer.from(
        computeAttestationRequestHash(input.nonce, input.payloadHash),
        'base64url',
      ),
      trustedRoots: options.trustedRoots ?? loadTrustedAttestationRoots(),
      policy: keyAttestationPolicy(options.policy),
      ...(options.revocationProvider
        ? { revocationProvider: options.revocationProvider }
        : {}),
      nowMs,
    });
    return fingerprintFromVerification(verification, input, nowMs);
  } catch (error) {
    const reason =
      error instanceof KeyAttestationError || error instanceof Error
        ? error.message
        : String(error);
    return {
      ...emptyHardwareFingerprint(),
      modelFamily: playIntegrityModel ?? softwareReportedModel,
      softwareReportedModel,
      osPatchLevelAgeDays: patchLevelAgeDays(input.osPatchLevel, nowMs),
      rootOfTrust: 'FAILED',
      chainVerified: false,
      attestationError: reason,
    };
  }
};
