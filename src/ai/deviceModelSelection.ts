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
 * Floor for the three capacities that decide whether the model can run
 * locally: RAM, free storage for the weights, and CPU parallelism.
 *
 * RAM and cores are properties of running a local model at all, not of one
 * model, so they stay fixed. Lowering them would let the app promise local
 * inference on a phone that then OOMs mid-generation, which is worse than
 * saying cloud up front.
 *
 * Storage is different: it is the size of a specific download, and the backend
 * decides what that is. `minStorageBytes` is the fallback for a screen asked
 * before the catalogue has answered — see `storageRequirementFor`.
 *
 * `minCpuCores` gates generation speed rather than whether the model loads.
 * Weights that fit in RAM on a 4-core device still produce tokens too slowly
 * to feel like a conversation. Core count is the only processor capacity
 * Android exposes portably — there is no reliable clock-speed or big.LITTLE
 * breakdown — so it stands in for the whole dimension.
 */
const REQUIREMENTS: {
  minMemoryBytes: number;
  minStorageBytes: number;
  minCpuCores: number;
} = { minMemoryBytes: 6 * GIB, minStorageBytes: 3 * GIB, minCpuCores: 8 };

/**
 * Free storage needed for a published bundle.
 *
 * A fixed 3 GB was the 2B teacher's download plus room to work, and it is
 * wrong in both directions for any other model: it refuses a 700 MB model on a
 * phone with 2 GB free, and it accepts a 4 GB model on a phone that cannot
 * hold it. The published size is the only honest input.
 *
 * The headroom is the download itself again, not a constant. A resumed
 * download keeps a partial file while the rest arrives, and the margin that
 * covers that has to scale with the thing being downloaded.
 */
export function storageRequirementFor(totalBytes?: number): number {
  if (typeof totalBytes !== 'number' || totalBytes <= 0) {
    return REQUIREMENTS.minStorageBytes;
  }
  return Math.round(totalBytes * 2);
}

const LOCAL_PROFILES: Exclude<MemoryProfile, 'cloud'>[] = ['on-device'];

const formatRequirement = (bytes: number): string =>
  `${Math.round(bytes / GIB)} GB`;

export function getModelOptionSupport(
  assessment: DeviceAssessment | null,
  /** What the backend publishes for the local profile, when it is known. */
  publishedBytes?: number,
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
          ? // Name what the device actually reported. Android's
            // Build.SUPPORTED_ABIS is the only thing that decides whether the
            // arm64 llama.cpp libraries can load, and plenty of phones with
            // 64-bit silicon ship a 32-bit ROM — telling someone their 64-bit
            // phone "is not 64-bit" reads as a bug unless the evidence is
            // attached.
            `This device reports ${
              hardware.supportedAbis.join(', ') || 'no ABIs'
            }; on-device models need a 64-bit ARM build (arm64-v8a).`
          : hardware.lowRamDevice
            ? 'Android reports this as a low-RAM device.'
            : null;

  const minStorageBytes = storageRequirementFor(publishedBytes);

  const local = LOCAL_PROFILES.map((profile): ModelOptionSupport => {
    const requirement = { ...REQUIREMENTS, minStorageBytes };
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

  /*
   * One local option, so the recommendation is simply whether it is usable.
   * This was a search for the largest supported tier when there were three.
   */
  const localSupported = local.some((option) => option.supported);

  const result = local.map((option) => ({
    ...option,
    recommended: option.supported,
  }));

  return [
    ...result,
    {
      profile: 'cloud',
      supported: true,
      recommended: !localSupported,
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
