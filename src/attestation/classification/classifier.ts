import Config from '../../../config/attestation.config';
import type {
  ClassifierDecision,
  ClassifierInput,
  ClassifierTrace,
  TrustTier,
} from '@attestation/shared/wire';

type Rule = {
  id: string;
  tier: TrustTier;
  reason: string;
  when: (input: ClassifierInput, nowMs: number) => boolean;
};

type EvaluatedRule = {
  rule: Rule;
  matched: boolean;
};

const isFinancial = (input: ClassifierInput): boolean =>
  input.action?.type === 'transfer' || input.action?.type === 'addPayee';

const hasFlag = (
  input: ClassifierInput,
  flag: string,
): boolean => input.velocity.flags.some((candidate) => candidate === flag);

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const classifierRules: Rule[] = [
  {
    id: 'verdict_failed',
    tier: 'BLOCKED',
    reason: 'base attestation verdict failed',
    when: (input) => !input.verdict.ok,
  },
  {
    id: 'hook_without_strong_integrity',
    tier: 'BLOCKED',
    reason: 'hooking framework detected without strong hardware integrity',
    when: (input) =>
      input.instrumentationReport.hookFrameworkDetected &&
      !input.verdict.strongIntegrity,
  },
  {
    id: 'hardware_discrepancy_ip_hopping',
    tier: 'BLOCKED',
    reason: 'hardware/software fingerprint discrepancy with IP hopping',
    when: (input) => input.hardware.discrepancy && hasFlag(input, 'IP_HOPPING'),
  },
  {
    id: 'key_attestation_chain_invalid',
    tier: 'BLOCKED',
    reason: 'submitted Android Key Attestation chain failed verification',
    when: (input) => Boolean(input.hardware.attestationError),
  },
  {
    id: 'financial_unverified_boot',
    tier: 'BLOCKED',
    reason: 'financial action on device without verified root of trust',
    when: (input) =>
      isFinancial(input) &&
      input.hardware.rootOfTrust !== undefined &&
      input.hardware.rootOfTrust !== 'VERIFIED',
  },
  {
    id: 'latency_anomaly',
    tier: 'RESTRICTED',
    reason: 'attestation latency anomaly',
    when: (input) => input.latency.latencyAnomaly,
  },
  {
    id: 'burst_or_asn_hopping',
    tier: 'RESTRICTED',
    reason: 'velocity anomaly detected',
    when: (input) => hasFlag(input, 'BURST') || hasFlag(input, 'ASN_HOPPING'),
  },
  {
    id: 'old_patch_level',
    tier: 'RESTRICTED',
    reason: 'operating system patch level is older than 180 days',
    when: (input) => input.hardware.osPatchLevelAgeDays > 180,
  },
  {
    id: 'highest_webauthn',
    tier: 'HIGHEST',
    reason: 'cross-platform trusted WebAuthn ceremony completed recently',
    when: (input, nowMs) =>
      Boolean(
        input.webauthn?.used &&
          input.webauthn.crossPlatform &&
          input.webauthn.aaguidTrusted &&
          input.webauthn.verifiedAtMs &&
          nowMs - input.webauthn.verifiedAtMs <= FIVE_MINUTES_MS,
      ),
  },
  {
    id: 'elevated_strong_integrity',
    tier: 'ELEVATED',
    reason: 'strong integrity has been stable for more than 30 days',
    when: (input, nowMs) =>
      Boolean(
        input.verdict.ok &&
          input.verdict.strongIntegrity &&
          input.hardware.hwBacked &&
          input.strongIntegritySinceMs &&
          nowMs - input.strongIntegritySinceMs >= THIRTY_DAYS_MS &&
          input.velocity.flags.length === 0,
      ),
  },
  {
    id: 'standard_passing',
    tier: 'STANDARD',
    reason: 'passing attestation with hardware-backed device evidence',
    when: (input) =>
      input.verdict.ok &&
      input.hardware.hwBacked &&
      !input.latency.latencyAnomaly &&
      input.velocity.flags.length === 0,
  },
];

const tierRank: Record<TrustTier, number> = {
  BLOCKED: 0,
  RESTRICTED: 1,
  STANDARD: 2,
  ELEVATED: 3,
  HIGHEST: 4,
};

export const classifyAttestation = (
  input: ClassifierInput,
  options: { nowMs?: number; debug?: boolean } = {},
): ClassifierDecision => {
  const nowMs = options.nowMs ?? Date.now();
  const evaluated: EvaluatedRule[] = classifierRules.map((rule) => ({
    rule,
    matched: rule.when(input, nowMs),
  }));

  const block = evaluated.find(
    (item) => item.matched && item.rule.tier === 'BLOCKED',
  );
  const restricted = evaluated.find(
    (item) => item.matched && item.rule.tier === 'RESTRICTED',
  );

  let tier: TrustTier = 'RESTRICTED';
  if (block) {
    tier = 'BLOCKED';
  } else if (restricted) {
    tier = 'RESTRICTED';
  } else {
    const positive = evaluated
      .filter(
        (item) =>
          item.matched &&
          ['STANDARD', 'ELEVATED', 'HIGHEST'].includes(item.rule.tier),
      )
      .sort((a, b) => tierRank[b.rule.tier] - tierRank[a.rule.tier])[0];
    tier = positive?.rule.tier ?? 'RESTRICTED';
  }

  const reasons = evaluated
    .filter((item) => item.matched)
    .map((item) => item.rule.reason);
  if (reasons.length === 0) reasons.push('no positive trust rule matched');

  const traceEnabled =
    options.debug ?? (Config.env === 'development' && Config.attestationDebug);
  if (traceEnabled) {
    const trace: ClassifierTrace = {
      enabled: true,
      tier,
      reasons,
      evaluatedRules: evaluated.map((item) => ({
        id: item.rule.id,
        matched: item.matched,
        contribution: item.matched ? item.rule.tier : 'none',
      })),
      input,
    };

    return { tier, reasons, trace };
  }

  return { tier, reasons };
};

export default classifyAttestation;
