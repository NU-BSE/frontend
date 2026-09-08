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
/** Where inference runs, as this screen's two cards name it. */
export type AiMode = 'local' | 'cloud';

/**
 * Which card to preselect, or null while that is not yet knowable.
 *
 * The screen preselects once and then leaves the choice alone, which is right
 * — re-deciding under someone mid-tap would be worse. But it means the one
 * decision has to be made on complete evidence, and the evidence arrives in
 * two parts that settle independently: the device assessment is a single
 * AsyncStorage read, while `useModelInstall` starts at `checking` and only
 * reaches `installed` after it has verified the weights on disk.
 *
 * Latching on the assessment alone therefore reads `installed` as false
 * whenever the file check has not finished yet, sees `download_required` for
 * a model that is sitting right there, and preselects Cloud. It is a race, so
 * it hides on a warm cache and shows up on a real phone: on a POCO with the
 * weights installed and the local card reading "Recommended for this device",
 * Cloud came up selected.
 *
 * That is not a cosmetic default. Continue writes the preselected mode, so a
 * user who chose on-device is moved to cloud inference — a different privacy
 * posture than the one they picked — and it undoes the profile that
 * `memoryProfileAfterInstallChange` moves to `on-device` when the weights
 * land, leaving the two mechanisms pulling against each other.
 *
 * Returning null until both parts have settled keeps "Cloud is the safe
 * default" exactly as it was; it only stops the screen deciding before it
 * knows.
 */
export function initialAiMode(input: {
  /** The device assessment query has settled. */
  deviceSettled: boolean;
  /** The install check has finished; `installed` now means something. */
  installSettled: boolean;
  localState: LocalModelState;
}): AiMode | null {
  if (!input.deviceSettled || !input.installSettled) return null;
  return input.localState === 'available' ? 'local' : 'cloud';
}
