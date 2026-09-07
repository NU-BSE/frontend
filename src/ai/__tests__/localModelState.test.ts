import type { DeviceAssessment } from '@/attestation/client/deviceAssessment';

import {
  getLocalModelReason,
  getLocalModelState,
  getRecommendedLocalProfile,
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
    expect(getLocalModelState(unsupported, true)).toBe('unsupported');
    expect(getLocalModelState(null, true)).toBe('unsupported');
  });

  it('9. reports available and recommends a profile for a capable device', () => {
    expect(getLocalModelState(capableAndroid, true)).toBe('available');
    expect(getRecommendedLocalProfile(capableAndroid)).toBe('performance');
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