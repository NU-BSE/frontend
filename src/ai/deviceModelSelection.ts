import type { DeviceAssessment } from '@/attestation/client/deviceAssessment';
import type { MemoryProfile } from '@/storage/prefs';

export type ModelOptionSupport = {
  profile: MemoryProfile;
  supported: boolean;
  recommended: boolean;
  reason: string;
};

const GIB = 1024 ** 3;

/**
 * Per-profile floor for the three capacities that decide whether a model can
 * run locally: RAM, free storage for the weights, and CPU parallelism.
 *
 * `minCpuCores` gates generation speed rather than whether the model loads.
 * Weights that fit in RAM on a 4-core device still produce tokens too slowly
 * to feel like a conversation at the larger profiles, so each step up asks for
 * more parallelism. Core count is the only processor capacity Android exposes
 * portably — there is no reliable clock-speed or big.LITTLE breakdown — so it
 * stands in for the whole dimension.
 *
 * These are the tuning knobs: adjust here, and both the recommendation and the
 * per-option reasons follow.
 */
const REQUIREMENTS: Record<
  Exclude<MemoryProfile, 'cloud'>,
  { minMemoryBytes: number; minStorageBytes: number; minCpuCores: number }
> = {
  efficient: { minMemoryBytes: 3 * GIB, minStorageBytes: 1 * GIB, minCpuCores: 4 },
  balanced: { minMemoryBytes: 4 * GIB, minStorageBytes: 2 * GIB, minCpuCores: 6 },
  performance: { minMemoryBytes: 6 * GIB, minStorageBytes: 3 * GIB, minCpuCores: 8 },
};

const LOCAL_PROFILES: Exclude<MemoryProfile, 'cloud'>[] = [
  'efficient',
  'balanced',
  'performance',
];

const formatRequirement = (bytes: number): string =>
  `${Math.round(bytes / GIB)} GB`;

export function getModelOptionSupport(
  assessment: DeviceAssessment | null,
): ModelOptionSupport[] {
  if (!assessment || assessment.platform !== 'android') {
    return [
      ...LOCAL_PROFILES.map((profile) => ({
        profile,
        supported: false,
        recommended: false,
        reason:
          assessment?.platform === 'unsupported'
            ? assessment.reason
            : 'Device assessment has not completed.',
      })),
      {
        profile: 'cloud' as const,
        supported: true,
        recommended: true,
        reason: 'Does not load model weights on this device.',
      },
    ];
  }

  const { hardware, integrity } = assessment;
  const has64BitArm = hardware.supportedAbis.some((abi) =>
    /arm64|aarch64/iu.test(abi),
  );
  const localBlockReason =
    integrity.status === 'blocked'
      ? `Local execution blocked by device integrity: ${
          integrity.riskFlags.join(', ') || 'unsafe environment'
        }.`
      : !integrity.nativeProbeAvailable
        ? 'Native attestation probe is unavailable in this build.'
        : !has64BitArm
          ? 'A 64-bit ARM Android device is required.'
          : hardware.lowRamDevice
            ? 'Android reports this as a low-RAM device.'
            : null;

  const local = LOCAL_PROFILES.map((profile): ModelOptionSupport => {
    const requirement = REQUIREMENTS[profile];
    if (localBlockReason) {
      return {
        profile,
        supported: false,
        recommended: false,
        reason: localBlockReason,
      };
    }

    /*
     * The native probe reports all three unconditionally, so a missing value
     * means the probe itself failed rather than that the device lacks the
     * capability. Refusing to guess is the safe branch: claiming support and
     * then OOM-ing mid-generation is worse than falling back to cloud.
     */
    if (
      typeof hardware.totalMemoryBytes !== 'number' ||
      typeof hardware.availableStorageBytes !== 'number' ||
      typeof hardware.cpuCoreCount !== 'number'
    ) {
      return {
        profile,
        supported: false,
        recommended: false,
        reason: 'RAM, storage or processor capacity could not be verified.',
      };
    }

    if (hardware.totalMemoryBytes < requirement.minMemoryBytes) {
      return {
        profile,
        supported: false,
        recommended: false,
        reason: `Requires at least ${formatRequirement(
          requirement.minMemoryBytes,
        )} RAM.`,
      };
    }

    if (hardware.availableStorageBytes < requirement.minStorageBytes) {
      return {
        profile,
        supported: false,
        recommended: false,
        reason: `Requires at least ${formatRequirement(
          requirement.minStorageBytes,
        )} free storage.`,
      };
    }

    if (hardware.cpuCoreCount < requirement.minCpuCores) {
      return {
        profile,
        supported: false,
        recommended: false,
        reason: `Requires at least ${requirement.minCpuCores} CPU cores; this device reports ${hardware.cpuCoreCount}.`,
      };
    }

    return {
      profile,
      supported: true,
      recommended: false,
      reason:
        integrity.status === 'warning'
          ? 'Supported, with device integrity warnings.'
          : 'Supported by this device.',
    };
  });

  const highestSupported = [...local]
    .reverse()
    .find((option) => option.supported)?.profile;

  const result = local.map((option) => ({
    ...option,
    recommended: option.profile === highestSupported,
  }));

  return [
    ...result,
    {
      profile: 'cloud',
      supported: true,
      recommended: !highestSupported,
      reason: 'Does not load model weights on this device.',
    },
  ];
}

export function getRecommendedMemoryProfile(
  assessment: DeviceAssessment | null,
): MemoryProfile {
  return (
    getModelOptionSupport(assessment).find((option) => option.recommended)
      ?.profile ?? 'cloud'
  );
}

export function canUseLocalProfile(
  profile: MemoryProfile,
  assessment: DeviceAssessment | null,
): boolean {
  if (profile === 'cloud') return false;
  return Boolean(
    getModelOptionSupport(assessment).find(
      (option) => option.profile === profile,
    )?.supported,
  );
}
