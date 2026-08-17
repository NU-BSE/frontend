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

/*
 * A 32-bit ROM on 64-bit silicon.
 *
 * Common on budget phones — the CPU is ARMv8 but the shipped Android build is
 * armeabi-v7a, so the arm64 llama.cpp libraries cannot load. Build.SUPPORTED_ABIS
 * is what decides this, and the message has to quote it: telling someone their
 * 64-bit phone "is not 64-bit" reads as a bug when the evidence is missing.
 */
{
  const thirtyTwoBit = assessment(4, 32);
  thirtyTwoBit.hardware.supportedAbis = ['armeabi-v7a', 'armeabi'];

  const options = getModelOptionSupport(thirtyTwoBit);
  const local = options.filter((option) => option.profile !== 'cloud');

  assertEqual(
    local.every((option) => !option.supported),
    true,
    'a 32-bit ROM disables every local profile',
  );
  assertEqual(
    local[0]?.reason.includes('armeabi-v7a'),
    true,
    'the reason quotes the ABIs the device actually reported',
  );
  assertEqual(
    local[0]?.reason.includes('arm64-v8a'),
    true,
    'the reason names the ABI that would be required',
  );
  assertEqual(
    options.find((option) => option.profile === 'cloud')?.supported,
    true,
    'cloud stays available on a 32-bit device',
  );
}

// The same hardware with a 64-bit ROM must not be blocked on this dimension.
{
  const sixtyFourBit = assessment(4, 32);
  sixtyFourBit.hardware.supportedAbis = ['arm64-v8a', 'armeabi-v7a'];
  const efficient = getModelOptionSupport(sixtyFourBit).find(
    (option) => option.profile === 'efficient',
  );
  assertEqual(
    efficient?.reason.includes('64-bit'),
    false,
    'an arm64 device is never told it needs a 64-bit build',
  );
}

console.log('device model selection: ok');
