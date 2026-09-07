import type { DeviceAssessment } from '@/attestation/client/deviceAssessment';
import type { MemoryProfile } from '@/storage/prefs';

import { ON_DEVICE_MODEL_PATH } from './config';
import { getModelOptionSupport } from './deviceModelSelection';
import { LOCAL_MODEL_PATHS } from './modelProfiles';

/**
 * Honest on-device model availability.
 *
 * The UI must never present "On this phone" as working when it is not. The
 * engine layer falls back to a stub when it cannot run locally; this module is
 * the front-end mirror of that fact, turning the device assessment plus the
 * shipped model configuration into a state the AI-mode screen can show without
 * promising anything it cannot honour.
 *
 *   unsupported       — the device cannot run local inference (RAM/storage/
 *                       cores/ABI/integrity), regardless of weights.
 *   download_required — the device is capable but no GGUF weights are present
 *                       on it; the engine would degrade to a stub.
 *   available         — capable and weights are configured; local runs.
 */
export type LocalModelState = 'unsupported' | 'available' | 'download_required';

export const LOCAL_PROFILES: Exclude<MemoryProfile, 'cloud'>[] = [
  'efficient',
  'balanced',
  'performance',
];

/** Whether any local profile has a model path configured in this build. */
export function localWeightsConfigured(): boolean {
  return Boolean(ON_DEVICE_MODEL_PATH) || LOCAL_PROFILES.some((p) => Boolean(LOCAL_MODEL_PATHS[p]));
}

export function getLocalModelState(
  assessment: DeviceAssessment | null,
  hasWeights: boolean = localWeightsConfigured(),
): LocalModelState {
  const support = getModelOptionSupport(assessment);
  const anyLocalSupported = LOCAL_PROFILES.some(
    (profile) => support.find((option) => option.profile === profile)?.supported,
  );
  if (!anyLocalSupported) return 'unsupported';
  return hasWeights ? 'available' : 'download_required';
}

/**
 * A human reason for the "On this phone" card. Picks the recommended local
 * profile's reason (the highest the device can run), falling back to the first
 * local reason. Returns null only when every local profile is supported, in
 * which case the card says "Recommended for this device".
 */
export function getLocalModelReason(
  assessment: DeviceAssessment | null,
): string | null {
  const support = getModelOptionSupport(assessment);
  const local = support.filter((option) => option.profile !== 'cloud');
  const preferred =
    local.find((option) => option.recommended) ?? local[0];
  return preferred?.supported ? null : (preferred?.reason ?? null);
}

/** The strongest local profile this device can run, or null. */
export function getRecommendedLocalProfile(
  assessment: DeviceAssessment | null,
): Exclude<MemoryProfile, 'cloud'> | null {
  const support = getModelOptionSupport(assessment);
  const recommended = support.find(
    (option) => option.profile !== 'cloud' && option.recommended,
  );
  return recommended && recommended.profile !== 'cloud'
    ? recommended.profile
    : null;
}