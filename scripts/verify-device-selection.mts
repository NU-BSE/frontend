import assert from 'node:assert/strict';

import {
  getModelOptionSupport,
  getRecommendedMemoryProfile,
} from '../src/ai/deviceModelSelection';
import type { DeviceAssessment } from '../src/attestation/client/deviceAssessment';

const GIB = 1024 ** 3;

const assessment = (
  ramGiB: number,
  storageGiB: number,
  overrides: Partial<
    Extract<DeviceAssessment, { platform: 'android' }>['integrity']
  > = {},
): Extract<DeviceAssessment, { platform: 'android' }> => ({
  schemaVersion: 1,
  platform: 'android',
  collectedAtMs: 0,
  hardware: {
    supportedAbis: ['arm64-v8a'],
    totalMemoryBytes: ramGiB * GIB,
    availableStorageBytes: storageGiB * GIB,
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

assert.equal(getRecommendedMemoryProfile(assessment(8, 8)), 'performance');
assert.equal(getRecommendedMemoryProfile(assessment(4, 4)), 'balanced');
assert.equal(getRecommendedMemoryProfile(assessment(3, 2)), 'efficient');
assert.equal(getRecommendedMemoryProfile(assessment(2, 8)), 'cloud');

const blocked = assessment(8, 8, {
  status: 'blocked',
  rooted: true,
  riskFlags: ['ROOT'],
});
assert.equal(getRecommendedMemoryProfile(blocked), 'cloud');
assert.equal(
  getModelOptionSupport(blocked).filter(
    (option) => option.profile !== 'cloud' && option.supported,
  ).length,
  0,
);

console.log('device model selection: ok');
