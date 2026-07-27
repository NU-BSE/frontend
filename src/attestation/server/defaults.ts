import Config from '../../../config/attestation.config';
import { AppleAppAttestVerifier, loadAppleAppAttestRootCa } from './appAttest';
import { GooglePlayIntegrityVerifier } from './playIntegrity';
import type { AppAttestVerifier, PlayIntegrityVerifier } from './verify';
import type { AsnLookup } from './velocity';

export class UnconfiguredPlayIntegrityVerifier implements PlayIntegrityVerifier {
  constructor(private readonly reason: string) {}

  async decodeIntegrityToken(): Promise<never> {
    throw new Error(
      `Play Integrity verifier is not configured: ${this.reason}`,
    );
  }
}

export class UnconfiguredAppAttestVerifier implements AppAttestVerifier {
  constructor(private readonly reason: string) {}

  async verifyRegistration(): Promise<never> {
    throw new Error(`App Attest verifier is not configured: ${this.reason}`);
  }

  async verifyAssertion(): Promise<never> {
    throw new Error(`App Attest verifier is not configured: ${this.reason}`);
  }
}

export class StaticAsnLookup implements AsnLookup {
  async lookup(ip: string): Promise<string> {
    return ip.startsWith('127.') || ip === '::1' ? 'local' : 'unknown';
  }
}

/**
 * Resolves ASNs through ipinfo.io so that ASN hopping is a real signal rather
 * than a constant. Results are cached per IP for an hour; a lookup failure
 * degrades to 'unknown' instead of failing the attestation.
 */
export class IpinfoAsnLookup implements AsnLookup {
  private readonly cache = new Map<string, { asn: string; loadedAtMs: number }>();

  constructor(
    private readonly token: string,
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly timeoutMs = 2_000,
  ) {}

  async lookup(ip: string): Promise<string> {
    if (!ip || ip.startsWith('127.') || ip === '::1') return 'local';
    const cached = this.cache.get(ip);
    if (cached && Date.now() - cached.loadedAtMs < this.ttlMs) return cached.asn;

    try {
      const response = await fetch(
        `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(
          this.token,
        )}`,
        { signal: AbortSignal.timeout(this.timeoutMs) },
      );
      if (!response.ok) return 'unknown';
      const json = (await response.json()) as {
        asn?: { asn?: string };
        org?: string;
      };
      const asn =
        json.asn?.asn ?? json.org?.match(/^AS\d+/u)?.[0] ?? 'unknown';
      this.cache.set(ip, { asn, loadedAtMs: Date.now() });
      return asn;
    } catch {
      return 'unknown';
    }
  }
}

export const createAsnLookup = (): AsnLookup => {
  if (Config.asn.provider === 'ipinfo' && Config.asn.ipinfoToken) {
    return new IpinfoAsnLookup(Config.asn.ipinfoToken);
  }
  return new StaticAsnLookup();
};

export type ResolvedVerifiers = {
  playIntegrityVerifier: PlayIntegrityVerifier;
  appAttestVerifier: AppAttestVerifier;
  /** Human-readable notes about what was wired up and what was not. */
  notes: string[];
};

const playIntegrityUnavailableReason = (): string | undefined => {
  if (!Config.android.playIntegrityProjectNumber) {
    return 'ATTESTATION_ANDROID_PLAY_INTEGRITY_PROJECT_NUMBER is not set';
  }
  if (
    !Config.google.serviceAccountJson &&
    !Config.google.serviceAccountKeyFile &&
    !process.env.GOOGLE_CLOUD_PROJECT &&
    !process.env.GCE_METADATA_HOST
  ) {
    return 'no Google service account is configured (set ATTESTATION_GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS, or run with Application Default Credentials)';
  }
  return undefined;
};

/**
 * Wires the real Google Play Integrity and Apple App Attest verifiers when the
 * credentials and trust anchors are present.
 *
 * When they are not: in production this throws (a server that silently accepts
 * nothing is worse than one that refuses to boot), and in development it falls
 * back to explicit "not configured" verifiers whose error message names the
 * missing setting.
 */
export const resolveVerifiers = (): ResolvedVerifiers => {
  const notes: string[] = [];
  const failures: string[] = [];

  const playIntegrityReason = playIntegrityUnavailableReason();
  let playIntegrityVerifier: PlayIntegrityVerifier;
  if (playIntegrityReason) {
    failures.push(`Play Integrity: ${playIntegrityReason}`);
    playIntegrityVerifier = new UnconfiguredPlayIntegrityVerifier(
      playIntegrityReason,
    );
  } else {
    playIntegrityVerifier = new GooglePlayIntegrityVerifier();
    notes.push(
      `Play Integrity: GooglePlayIntegrityVerifier for package ${Config.android.packageName} (project ${Config.android.playIntegrityProjectNumber})`,
    );
  }

  let appAttestVerifier: AppAttestVerifier;
  let appAttestReason: string | undefined;
  let appleRootCaPem: string | undefined;
  try {
    appleRootCaPem = loadAppleAppAttestRootCa();
  } catch (error) {
    appAttestReason = `Apple App Attestation Root CA could not be read: ${String(error)}`;
  }
  if (!appAttestReason && !appleRootCaPem) {
    appAttestReason =
      'Apple App Attestation Root CA is not pinned (set ATTESTATION_IOS_APP_ATTEST_ROOT_CA_PEM or _PATH)';
  }
  if (!appAttestReason && !Config.ios.teamId) {
    appAttestReason = 'ATTESTATION_IOS_TEAM_ID is not set';
  }
  if (appAttestReason || !appleRootCaPem) {
    failures.push(`App Attest: ${appAttestReason ?? 'unavailable'}`);
    appAttestVerifier = new UnconfiguredAppAttestVerifier(
      appAttestReason ?? 'unavailable',
    );
  } else {
    try {
      appAttestVerifier = new AppleAppAttestVerifier(appleRootCaPem);
      notes.push(
        `App Attest: AppleAppAttestVerifier for ${Config.ios.teamId}.${Config.ios.bundleId} (${Config.ios.appAttestEnvironment})`,
      );
    } catch (error) {
      const reason = String(error);
      failures.push(`App Attest: ${reason}`);
      appAttestVerifier = new UnconfiguredAppAttestVerifier(reason);
    }
  }

  if (failures.length > 0) {
    if (Config.requireProductionDependencies) {
      throw new Error(
        `Attestation verifiers are not configured:\n  - ${failures.join('\n  - ')}`,
      );
    }
    notes.push(...failures.map((failure) => `NOT CONFIGURED — ${failure}`));
  }

  return { playIntegrityVerifier, appAttestVerifier, notes };
};
