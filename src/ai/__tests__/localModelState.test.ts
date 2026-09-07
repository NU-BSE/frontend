import type { DeviceAssessment } from '@/attestation/client/deviceAssessment';

import {
  getLocalModelReason,
  getLocalModelState,
  initialAiMode,
} from '@/ai/localModelState';

const GIB = 1024 ** 3;

function androidAssessment(overrides: {
  ramBytes: number;
  storageBytes: number;
  cores: number;
}): DeviceAssessment {
  return {
    schemaVersion: 1,
    platform: 'android',
    collectedAtMs: 0,
    hardware: {
      supportedAbis: ['arm64-v8a'],
      cpuCoreCount: overrides.cores,
      totalMemoryBytes: overrides.ramBytes,
      availableStorageBytes: overrides.storageBytes,
      lowRamDevice: false,
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
    },
    keystore: {
      checked: false,
      hardwareBacked: false,
      strongBoxBacked: false,
      certificateChainLength: 0,
    },
    probeFailures: [],
  };
}

const capableAndroid = androidAssessment({
  ramBytes: 8 * GIB,
  storageBytes: 8 * GIB,
  cores: 8,
});

const weakAndroid = androidAssessment({
  ramBytes: 1 * GIB,
  storageBytes: 8 * GIB,
  cores: 8,
});

const unsupported: DeviceAssessment = {
  schemaVersion: 1,
  platform: 'unsupported',
  collectedAtMs: 0,
  reason: 'no native probe',
};

describe('honest local model state', () => {
  it('10. reports unsupported when the device cannot run local inference', () => {
    expect(getLocalModelState(weakAndroid, true)).toBe('unsupported');
    expect(getLocalModelState(weakAndroid, false)).toBe('unsupported');
    expect(getLocalModelState(unsupported, true)).toBe('unsupported');
    expect(getLocalModelState(null, true)).toBe('unsupported');
  });

  it('9. reports available when capable and the weights are installed', () => {
    expect(getLocalModelState(capableAndroid, true)).toBe('available');
  });

  it('11. reports download_required when capable but no weights are on device', () => {
    expect(getLocalModelState(capableAndroid, false)).toBe('download_required');
  });

  it('gives a human reason only when local is not available', () => {
    expect(getLocalModelReason(capableAndroid)).toBeNull();
    expect(getLocalModelReason(weakAndroid)).toMatch(/RAM/);
    expect(getLocalModelReason(unsupported)).toBe('no native probe');
  });
});
describe('preselecting the AI mode', () => {
  const settled = { deviceSettled: true, installSettled: true };

  it('waits for the install check before deciding anything', () => {
    // The assessment has landed and says the phone is capable; the file check
    // has not, so `installed` is still false and localState still reads
    // download_required. Deciding here is what preselects Cloud for a user
    // whose weights are already on disk.
    expect(
      initialAiMode({
        deviceSettled: true,
        installSettled: false,
        localState: getLocalModelState(capableAndroid, false),
      }),
    ).toBeNull();
  });

  it('waits for the device assessment too', () => {
    expect(
      initialAiMode({
        deviceSettled: false,
        installSettled: true,
        localState: getLocalModelState(capableAndroid, true),
      }),
    ).toBeNull();
  });

  it('preselects local once both parts agree the weights are usable', () => {
    expect(
      initialAiMode({ ...settled, localState: getLocalModelState(capableAndroid, true) }),
    ).toBe('local');
  });

  it('keeps cloud as the default when local cannot run or is not downloaded', () => {
    expect(
      initialAiMode({ ...settled, localState: getLocalModelState(capableAndroid, false) }),
    ).toBe('cloud');
    expect(
      initialAiMode({ ...settled, localState: getLocalModelState(weakAndroid, true) }),
    ).toBe('cloud');
  });
});
