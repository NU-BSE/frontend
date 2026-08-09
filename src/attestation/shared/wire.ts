export type MobilePlatform = 'android' | 'ios';

export type TrustTier =
  | 'BLOCKED'
  | 'RESTRICTED'
  | 'STANDARD'
  | 'ELEVATED'
  | 'HIGHEST';

export type SensitiveAction =
  | {
      type: 'transfer';
      amount: number;
      currency: string;
      toAccountId: string;
      memo?: string;
    }
  | { type: 'addPayee'; accountId: string; routingNumber: string }
  | { type: 'elevatedLogin' }
  | { type: 'policyChange'; policyId: string; newValue: unknown };

export type InstrumentationReport = {
  platform: MobilePlatform;
  debuggerAttached: boolean;
  emulator: boolean;
  rootedOrJailbroken: boolean;
  hookFrameworkDetected: boolean;
  debuggablePackage: boolean;
  untrustedInstaller: boolean;
  suspiciousEnvVars: string[];
  deviceModel?: string;
  sdkInt?: number;
  signals: Record<string, unknown>;
  collectedAtMs: number;
};

export type AttestationErrorCode =
  | 'DEVICE_NOT_SUPPORTED'
  | 'INTEGRITY_SERVICE_UNAVAILABLE'
  | 'NETWORK'
  | 'KEY_GENERATION_FAILED'
  | 'ASSERTION_FAILED'
  | 'NONCE_REJECTED'
  | 'UNKNOWN';

export type AndroidAttestationSuccess = {
  ok: true;
  platform: 'android';
  token: string;
  provider: 'playIntegrity';
  hardwareKeyAttestation?: {
    alias: string;
    certificateChainBase64: string[];
  };
};

export type IosAttestationSuccess = {
  ok: true;
  platform: 'ios';
  assertion: string;
  keyId: string;
  attestation?: string;
  provider: 'appAttest';
};

export type BaseAttestationResult =
  | AndroidAttestationSuccess
  | IosAttestationSuccess
  | {
      ok: false;
      code: AttestationErrorCode;
      retryable: boolean;
      details?: string;
    };

export type NonceRequest = {
  clientTs: number;
};

export type NonceResponse = {
  nonce: string;
  serverIssuedAt: number;
};

export type AttestationTelemetryEvent = {
  name: string;
  platform?: MobilePlatform;
  startedAtMs?: number;
  endedAtMs?: number;
  durationMs?: number;
  ok?: boolean;
  code?: string;
  details?: Record<string, unknown>;
};

export type AttestationTelemetry = {
  record(event: AttestationTelemetryEvent): void | Promise<void>;
};

export type VerifyRequest = {
  action: SensitiveAction;
  canonicalJson: string;
  nonce: string;
  attestation: BaseAttestationResult;
  instrumentationReport: InstrumentationReport;
  webauthn?: {
    challengeId: string;
    response: unknown;
  };
};

export type AttestationVerdict = {
  ok: boolean;
  platform: MobilePlatform;
  signals: Record<string, unknown>;
  rawVerdict: Record<string, unknown>;
  hwBacked: boolean;
  strongIntegrity: boolean;
  firstSeen: boolean;
};

export type VelocityFlag =
  | 'BURST'
  | 'IP_HOPPING'
  | 'ASN_HOPPING'
  | 'LOW_ENTROPY_PAYLOADS'
  | 'NEW_DEVICE';

export type VelocitySignals = {
  requestsPerMinute: number;
  requestsPerHour: number;
  distinctIpCount1h: number;
  distinctAsnCount1h: number;
  payloadEntropy: number;
  flags: VelocityFlag[];
};

export type AttestationSecurityLevel =
  | 'SOFTWARE'
  | 'TRUSTED_ENVIRONMENT'
  | 'STRONG_BOX';

export type HardwareFingerprint = {
  hwBacked: boolean;
  strongBox: boolean;
  verifiedBoot: boolean;
  osPatchLevelAgeDays: number;
  modelFamily: string;
  softwareReportedModel: string;
  discrepancy: boolean;
  /** `rootOfTrust.verifiedBootState` from the Android Key Description. */
  rootOfTrust?: 'VERIFIED' | 'SELF_SIGNED' | 'UNVERIFIED' | 'FAILED';
  /** `attestationSecurityLevel` from the Android Key Description. */
  securityLevel?: AttestationSecurityLevel;
  /** StrongBox was unavailable and a TEE-backed key was accepted instead. */
  teeFallback?: boolean;
  /** The submitted Android Key Attestation chain verified end to end. */
  chainVerified?: boolean;
  /** The chain terminates in a pinned Google Hardware Attestation Root. */
  rootTrusted?: boolean;
  /** `osVersion` from the Key Description, e.g. "15.0.0". */
  osVersion?: string;
  /** `rootOfTrust.deviceLocked` from the Key Description. */
  deviceLocked?: boolean;
  /** Why chain verification failed, when it did. */
  attestationError?: string;
  /** Non-fatal observations from chain verification. */
  warnings?: string[];
};

export type LatencySignals = {
  rttMs: number;
  nonceAgeMs: number;
  clockSkewMs: number;
  latencyAnomaly: boolean;
};

export type ClassifierInput = {
  verdict: AttestationVerdict;
  instrumentationReport: InstrumentationReport;
  velocity: VelocitySignals;
  hardware: HardwareFingerprint;
  latency: LatencySignals;
  webauthn?: {
    used: boolean;
    crossPlatform: boolean;
    aaguidTrusted: boolean;
    verifiedAtMs?: number;
  };
  action?: SensitiveAction;
  strongIntegritySinceMs?: number;
};

export type ClassifierTrace = {
  enabled: boolean;
  tier: TrustTier;
  reasons: string[];
  evaluatedRules: Array<{
    id: string;
    matched: boolean;
    contribution: TrustTier | 'none';
  }>;
  input?: ClassifierInput;
};

export type ClassifierDecision = {
  tier: TrustTier;
  reasons: string[];
  trace?: ClassifierTrace;
};

export type VerifyResponse =
  | {
      ok: true;
      accessToken: string;
      tier: Exclude<TrustTier, 'BLOCKED'>;
      expiresAt: number;
      classifierTrace?: ClassifierTrace;
    }
  | {
      ok: false;
      code:
        | AttestationErrorCode
        | 'BLOCKED'
        | 'PAYLOAD_BINDING_INVALID'
        | 'REQUIRES_ELEVATION';
      requiredTier?: TrustTier;
      retryable: boolean;
      message?: string;
      classifierTrace?: ClassifierTrace;
    };

export type BoundPayload = {
  payloadHash: string;
  canonicalJson: string;
};

export type TelegramMiniAppAuthRequest = {
  initData: string;
  customUserId: string;
  requestedPlatform: 'android';
};

export type TelegramMiniAppAuthResponse =
  | {
      ok: true;
      customUserId: string;
      telegramUserId: string;
      launchToken: string;
      nativeLaunchUrl: string;
      expiresAt: number;
    }
  | {
      ok: false;
      code:
        | 'TELEGRAM_INIT_DATA_INVALID'
        | 'CUSTOM_USER_ID_INVALID'
        | 'TELEGRAM_BOT_NOT_CONFIGURED';
      message: string;
      retryable: boolean;
    };

export type NativeLaunchConsumeRequest = {
  launchToken: string;
};

export type NativeLaunchConsumeResponse =
  | {
      ok: true;
      customUserId: string;
      telegramUserId: string;
      launchSessionId: string;
    }
  | {
      ok: false;
      code: 'LAUNCH_TOKEN_INVALID' | 'LAUNCH_TOKEN_EXPIRED';
      message: string;
      retryable: boolean;
    };

export type AttestationResultRecord = {
  ref: string;
  customUserId: string;
  telegramUserId?: string;
  ok: boolean;
  deviceModel?: string;
  platform?: MobilePlatform;
  trustTier?: string;
  detail?: string;
  attestedAtMs: number;
};

export type SubmitAttestationResultRequest = Omit<
  AttestationResultRecord,
  'attestedAtMs'
>;

export type SubmitAttestationResultResponse =
  | { ok: true; ref: string }
  | { ok: false; message: string };

export type GetAttestationResultResponse =
  | { ok: true; result: AttestationResultRecord }
  | { ok: false; message: string };

