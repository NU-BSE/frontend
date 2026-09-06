import {
  getModelOptionSupport,
  getRecommendedMemoryProfile,
  storageRequirementFor,
} from '../src/ai/deviceModelSelection';
import {
  MAX_CONTEXT_SIZE,
  MIN_CONTEXT_SIZE,
  runtimeForModel,
} from '../src/ai/modelProfiles';
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

/*
 * One local option now, so these are a threshold rather than a ladder. The 2B
 * teacher needs 6 GB RAM, 3 GB free storage and 8 cores; anything short of
 * that gets cloud rather than a smaller model, because there is no longer a
 * smaller model to fall back to.
 */
assertEqual(getRecommendedMemoryProfile(assessment(8, 8)), 'on-device');
assertEqual(
  getRecommendedMemoryProfile(assessment(4, 4)),
  'cloud',
  '4 GB RAM no longer earns a smaller local model',
);
assertEqual(getRecommendedMemoryProfile(assessment(3, 2)), 'cloud');
assertEqual(getRecommendedMemoryProfile(assessment(2, 8)), 'cloud');

// The boundary itself, which is where an off-by-one would hide.
assertEqual(
  getRecommendedMemoryProfile(assessment(6, 3, {}, 8)),
  'on-device',
  'a device exactly at the floor qualifies',
);
assertEqual(
  getRecommendedMemoryProfile(assessment(5, 3, {}, 8)),
  'cloud',
  'one GB under the RAM floor does not',
);

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
  'on-device',
  '8 cores meet the processor floor',
);
assertEqual(
  getRecommendedMemoryProfile(assessment(8, 8, {}, 6)),
  'cloud',
  '6 cores fall short despite ample RAM — there is no smaller tier to drop to',
);
assertEqual(
  getRecommendedMemoryProfile(assessment(8, 8, {}, 2)),
  'cloud',
  '2 cores rule out local inference',
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
  (option) => option.profile === 'on-device',
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
  const local = getModelOptionSupport(sixtyFourBit).find(
    (option) => option.profile === 'on-device',
  );
  assertEqual(
    local?.reason.includes('64-bit'),
    false,
    'an arm64 device is never told it needs a 64-bit build',
  );
}

/*
 * Migration off the retired tiers.
 *
 * Someone who chose a local model before the 0.5B/1B/1.5B students were
 * retired must stay local. Falling through to the default would move them to
 * cloud inference — a different privacy posture than the one they picked, and
 * silent.
 *
 * getMemoryProfile reads AsyncStorage, which does not exist here, so the
 * mapping is asserted directly against the rule the function implements.
 */
{
  const RETIRED = ['efficient', 'balanced', 'performance'];
  const migrate = (raw: string | null): string => {
    if (raw === 'cloud' || raw === 'on-device') return raw;
    if (raw !== null && RETIRED.includes(raw)) return 'on-device';
    return 'cloud';
  };

  for (const retired of RETIRED) {
    assertEqual(migrate(retired), 'on-device', `${retired} migrates to on-device`);
  }
  assertEqual(migrate('cloud'), 'cloud', 'an explicit cloud choice is kept');
  assertEqual(migrate('on-device'), 'on-device', 'a current local choice is kept');
  assertEqual(migrate(null), 'cloud', 'an unanswered question defaults to cloud');
  assertEqual(migrate('nonsense'), 'cloud', 'an unrecognised value defaults to cloud');
}

/*
 * The app downloads whichever model the backend publishes, so nothing about
 * the model may be a constant in here.
 *
 * Storage was a flat 3 GB: the 2B teacher's download plus room to work. That
 * refuses a 700 MB model on a phone with 2 GB free and accepts a 4 GB model on
 * a phone that cannot hold it. The published size is the only honest input.
 */
{
  const GB = 1024 ** 3;

  assertEqual(
    storageRequirementFor(700 * 1024 ** 2),
    Math.round(700 * 1024 ** 2 * 2),
    'a small model asks for room for itself, not for the largest model ever served',
  );
  assertEqual(
    storageRequirementFor(4 * GB),
    8 * GB,
    'and a large one asks for more than the old fixed figure',
  );
  assertEqual(
    storageRequirementFor(undefined),
    3 * GB,
    'an unanswered catalogue falls back rather than admitting everything',
  );
  assertEqual(
    storageRequirementFor(0),
    3 * GB,
    'and so does a nonsense size',
  );

  // The gate has to move with it, not just the helper.
  const smallModel = 400 * 1024 ** 2;
  const phoneWith1GbFree = assessment(8, 1);
  const supportedForSmall = getModelOptionSupport(
    phoneWith1GbFree,
    smallModel,
  ).find((option) => option.profile === 'on-device')?.supported;
  const supportedForDefault = getModelOptionSupport(phoneWith1GbFree).find(
    (option) => option.profile === 'on-device',
  )?.supported;

  assertEqual(
    supportedForSmall,
    true,
    'a 400 MB model is offered on a phone with 1 GB free',
  );
  assertEqual(
    supportedForDefault,
    false,
    'while the same phone is refused when the size is unknown',
  );
}

/*
 * And the runtime limits follow the model too.
 *
 * 4096/480 was measured against the 2B teacher. Correct for exactly one model,
 * and silently wrong for the next one the backend serves.
 */
{
  const GB = 1024 ** 3;

  const declared = runtimeForModel({
    totalBytes: 3 * GB,
    contextSize: 8192,
    maxTokens: 512,
  });
  assertEqual(declared.contextSize, 8192, 'what the backend declares wins');
  assertEqual(declared.maxTokens, 512, 'including the reply budget');

  const small = runtimeForModel({ totalBytes: 500 * 1024 ** 2 });
  const large = runtimeForModel({ totalBytes: 3 * GB });
  assertEqual(
    small.contextSize > large.contextSize,
    true,
    'without a declaration, a smaller download gets the wider window',
  );

  assertEqual(
    runtimeForModel({ totalBytes: 3 * GB, contextSize: 128 }).contextSize,
    MIN_CONTEXT_SIZE,
    'a window under the planner prompt is raised — llama.cpp refuses it, it does not truncate',
  );
  assertEqual(
    runtimeForModel({ totalBytes: GB, contextSize: 1_000_000 }).contextSize,
    MAX_CONTEXT_SIZE,
    'and one no phone can hold is capped rather than trusted',
  );

  assertEqual(
    runtimeForModel(null).contextSize,
    MIN_CONTEXT_SIZE,
    'no bundle at all still yields a usable window',
  );

  const capped = runtimeForModel({ contextSize: 4096, maxTokens: 4000 });
  assertEqual(
    capped.maxTokens <= 2048,
    true,
    'a reply budget larger than the window it must fit in is cut down',
  );

  const derivedReply = runtimeForModel({ totalBytes: 500 * 1024 ** 2 });
  assertEqual(
    derivedReply.maxTokens > 0 &&
      derivedReply.maxTokens < derivedReply.contextSize,
    true,
    'an underived reply budget is a share of the window, never all of it',
  );
}

console.log('device model selection: ok');
