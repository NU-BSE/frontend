import type { DeviceAssessment } from '@/attestation/client/deviceAssessment';

import { getModelOptionSupport } from './deviceModelSelection';

/**
 * Honest on-device model availability for the AI-mode screen.
 *
 * There is exactly one local profile now (`on-device`), and its weights are
 * downloaded at runtime rather than shipped in the APK. So "can this device
 * run local inference" and "are the weights here" are two separate questions;
 * `installed` is the answer to the second one, provided by `useModelInstall`.
 *
 *   unsupported       — the device cannot run local inference (RAM/storage/
 *                       cores/ABI/integrity), regardless of weights.
 *   download_required — the device is capable but the weights are not on it.
 *   available         — capable and the weights are installed; local runs.
 */
export type LocalModelState = 'unsupported' | 'available' | 'download_required';

export function getLocalModelState(
  assessment: DeviceAssessment | null,
  installed: boolean,
): LocalModelState {
  const support = getModelOptionSupport(assessment);
  const onDevice = support.find((option) => option.profile === 'on-device');
  if (!onDevice?.supported) return 'unsupported';
  return installed ? 'available' : 'download_required';
}

/**
 * A human reason for the "On this phone" card. Null when the device is
 * capable, so the card can say "Recommended for this device".
 */
export function getLocalModelReason(
  assessment: DeviceAssessment | null,
): string | null {
  const support = getModelOptionSupport(assessment);
  const onDevice = support.find((option) => option.profile === 'on-device');
  if (!onDevice) return null;
  return onDevice.supported ? null : (onDevice.reason ?? null);
}