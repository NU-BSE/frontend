import {
  getModelOptionSupport,
  getRecommendedMemoryProfile,
} from '../src/ai/deviceModelSelection';
import type { DeviceAssessment } from '../src/attestation/client/deviceAssessment';

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(
      message ?? `Expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

const GIB = 1024 ** 3;

const assessment = (
  ramGiB: number,
  storageGiB: number,
  overrides: Partial<
    Extract<DeviceAssessment, { platform: 'android' }>['integrity']
  > = {},
  // `null` means "the probe did not report it". Not `undefined`: passing that
  // explicitly triggers the default parameter, which would silently test the
  // 8-core case instead of the unverified one.
  cpuCoreCount: number | null = 8,
): Extract<DeviceAssessment, { platform: 'android' }> => ({
  schemaVersion: 1,
  platform: 'android',
  collectedAtMs: 0,
  hardware: {
    supportedAbis: ['arm64-v8a'],
    totalMemoryBytes: ramGiB * GIB,
    availableStorageBytes: storageGiB * GIB,
    lowRamDevice: false,
    ...(cpuCoreCount === null ? {} : { cpuCoreCount }),
  },
  integrity: {
    status: 'trusted',
    nativeProbeAvailable: true,
    physicalDevice: true,
    debuggerAttached: false,
    rooted: false,
    hookFrameworkDetected: false,
    debuggablePackage: false,
    untrustedInstaller: false,
    riskFlags: [],
    ...overrides,
  },
  keystore: {
    checked: true,
    hardwareBacked: true,
    strongBoxBacked: false,
    certificateChainLength: 3,
  },
  probeFailures: [],
});

assertEqual(getRecommendedMemoryProfile(assessment(8, 8)), 'performance');
assertEqual(getRecommendedMemoryProfile(assessment(4, 4)), 'balanced');
assertEqual(getRecommendedMemoryProfile(assessment(3, 2)), 'efficient');
assertEqual(getRecommendedMemoryProfile(assessment(2, 8)), 'cloud');

const blocked = assessment(8, 8, {
  status: 'blocked',
  rooted: true,
  riskFlags: ['ROOT'],
});
assertEqual(getRecommendedMemoryProfile(blocked), 'cloud');
assertEqual(
  getModelOptionSupport(blocked).filter(
    (option) => option.profile !== 'cloud' && option.supported,
  ).length,
  0,
);

/*
 * Processor gating. RAM and storage are held generous in every case below, so
 * only the core count can be responsible for the profile that comes back.
 */
assertEqual(
  getRecommendedMemoryProfile(assessment(8, 8, {}, 8)),
  'performance',
  '8 cores reach the performance profile',
);
assertEqual(
  getRecommendedMemoryProfile(assessment(8, 8, {}, 6)),
  'balanced',
  '6 cores cap the recommendation at balanced despite ample RAM',
);
assertEqual(
  getRecommendedMemoryProfile(assessment(8, 8, {}, 4)),
  'efficient',
  '4 cores cap the recommendation at efficient despite ample RAM',
);
assertEqual(
  getRecommendedMemoryProfile(assessment(8, 8, {}, 2)),
  'cloud',
  '2 cores rule out every local profile',
);

// A probe failure leaves cpuCoreCount undefined. Unverified must not read as
// capable — the fallback is cloud, not an optimistic guess.
assertEqual(
  getRecommendedMemoryProfile(assessment(8, 8, {}, null)),
  'cloud',
  'an unverified processor falls back to cloud',
);
assertEqual(
  getModelOptionSupport(assessment(8, 8, {}, null)).filter(
    (option) => option.profile !== 'cloud' && option.supported,
  ).length,
  0,
  'an unverified processor disables every local profile',
);

// The reason strings drive the disabled-option copy in onboarding, so they
// have to name the dimension that actually failed.
const twoCore = getModelOptionSupport(assessment(8, 8, {}, 2)).find(
  (option) => option.profile === 'performance',
);
assertEqual(
  twoCore?.reason.includes('CPU cores'),
  true,
  'a core-count failure is reported as a processor limit',
);

console.log('device model selection: ok');
