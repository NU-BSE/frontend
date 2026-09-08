/**
 * Types for `attestation.config.js`.
 *
 * The implementation is CommonJS because `app.config.js` must `require` it at
 * build time; this gives the TypeScript tree the same object with types, so
 * there is one set of defaults rather than two files that drift.
 */

export type AppAttestEnvironment = 'development' | 'production';
export type AsnProvider = 'none' | 'ipinfo';
export type JitSignerProvider = 'gcpKms' | 'env' | 'local';

export interface AttestationPublicConfig {
  serverBaseUrl: string;
  attestationDebug: boolean;
  nonceTtlMs: number;
  maxAttestedLatencyMs: number;
  telegramBotUsername: string;
  webauthn: { rpId: string; rpName: string; origin: string };
}

export interface AttestationConfigShape {
  env: string;
  isProduction: boolean;
  requireProductionDependencies: boolean;
  serverBaseUrl: string;
  attestationDebug: boolean;
  nonceTtlMs: number;
  maxAttestedLatencyMs: number;

  android: {
    packageName: string;
    playIntegrityProjectNumber: string | undefined;
    expectedCertificateSha256: string[];
    keyAttestation: {
      requireTrustedRoot: boolean;
      requireStrongBox: boolean;
      allowSoftwareSecurityLevel: boolean;
      revocationEnabled: boolean;
      revocationStatusUrl: string;
      trustedRootsPem: string | undefined;
      trustedRootsPath: string | undefined;
    };
  };

  ios: {
    teamId: string;
    bundleId: string;
    appAttestEnvironment: AppAttestEnvironment;
  };

  webauthn: {
    rpId: string;
    rpName: string;
    origin: string;
    associatedDomains: string[];
    mds3Url: string;
  };

  telegram: {
    botToken: string;
    botUsername: string;
    initDataMaxAgeSeconds: number;
    nativeLaunchTtlSeconds: number;
    nativeScheme: string;
    nativeLaunchScheme: string;
    androidPackage: string;
    launchTtlMs: number;
  };

  jit: {
    apiAudience: string;
    ttlByTierSeconds: {
      RESTRICTED: number;
      STANDARD: number;
      ELEVATED: number;
      HIGHEST: number;
    };
    signer: {
      provider: JitSignerProvider;
      activeKid: string;
      activePrivateKeyPem: string | undefined;
      retiredPublicKeysJson: string | undefined;
      activeKeyCreatedAt: string | undefined;
      rotationIntervalDays: number;
      gcpKms: {
        keyVersionName: string | undefined;
        retiredKeyVersionNames: string[];
      };
    };
  };

  velocity: {
    burstRequestsPerMinute: number;
    ipHoppingDistinctIps1h: number;
    asnHoppingDistinctAsns1h: number;
    lowEntropyBitsPerSymbol: number;
    retentionHours: number;
  };

  asn: { provider: AsnProvider; ipinfoToken: string | undefined };

  database: {
    url: string;
    poolMax: number;
    ssl: boolean;
    autoMigrate: boolean;
  };

  redis: { url: string; keyPrefix: string };

  google: {
    serviceAccountJson: string | undefined;
    serviceAccountKeyFile: string | undefined;
  };

  public: AttestationPublicConfig;
}

export declare const AttestationConfig: AttestationConfigShape;
declare const _default: AttestationConfigShape;
export default _default;
