import { xhrHttpStream } from '@tanstack/ai-client';
import type { ConnectionAdapter } from '@tanstack/ai-client';

import type { DeviceAssessment } from '@/attestation/client/deviceAssessment';
import type { MemoryProfile } from '@/storage/prefs';
import {
  BACKEND_API_URL,
  FORCED_ENGINE,
  ON_DEVICE_DEFAULTS,
  REMOTE_AI_BASE_URL,
  SYSTEM_PROMPT,
} from './config';
import { canUseLocalProfile } from './deviceModelSelection';
import { engineConnection } from './engineConnection';
import {
  createOnDeviceEngine,
  isOnDeviceSupported,
} from './engines/onDeviceEngine';
import { createStubEngine } from './engines/stubEngine';
import { LOCAL_MODEL_PATHS, LOCAL_MODEL_RUNTIME } from './modelProfiles';
import type { EngineDescriptor, EngineOrigin } from './types';

export * from './types';
export { engineConnection } from './engineConnection';
export { isOnDeviceSupported } from './engines/onDeviceEngine';

export type EngineSelection = {
  memoryProfile: MemoryProfile;
  assessment: DeviceAssessment | null;
};

export interface EngineConfigOverrides {
  forcedEngine?: '' | 'on-device' | 'remote' | 'stub';
  /** Raw backend origin (EXPO_PUBLIC_API_URL). Injected for tests. */
  backendApiUrl?: string;
  /**
   * Weights downloaded to this device, if any.
   *
   * The model is not in the APK — a gigabyte inside a Play download is a
   * gigabyte every user pays for, including those who pick cloud inference —
   * so the usual source of a local model is an install, not a build-time
   * constant. `EXPO_PUBLIC_LLM_MODEL_PATH` remains as an override for a
   * developer who has pushed weights to a device by hand.
   */
  installedModelPath?: string | null;
}

export function resolveEngine(
  selection: EngineSelection,
  config: EngineConfigOverrides = {},
): EngineDescriptor {
  const forced = config.forcedEngine ?? FORCED_ENGINE;
  const backendApiUrl = config.backendApiUrl ?? BACKEND_API_URL;

  if (forced === 'stub') {
    return { origin: 'stub', engine: createStubEngine() };
  }

  const profile = selection.memoryProfile;
  if (profile === 'cloud' || forced === 'remote') {
    // Remote mode is enabled by a configured backend origin — NOT by the
    // legacy TanStack stream URL. The agent talks to POST /agent/step there.
    if (!backendApiUrl) {
      return {
        origin: 'stub',
        engine: createStubEngine(),
        degradedReason:
          'Remote agent backend is not configured (EXPO_PUBLIC_API_URL).',
      };
    }
    return { origin: 'remote', engine: createStubEngine() };
  }

  // A downloaded model wins over the build-time path: the env var is a
  // developer's override, and a user who has just waited for a download should
  // get what they downloaded.
  const modelPath = config.installedModelPath || LOCAL_MODEL_PATHS[profile];
  const assessmentAllowsLocal = canUseLocalProfile(
    profile,
    selection.assessment,
  );
  const canRunOnDevice =
    assessmentAllowsLocal && Boolean(modelPath) && isOnDeviceSupported();

  if ((forced === 'on-device' || !forced) && canRunOnDevice) {
    return {
      origin: 'on-device',
      engine: createOnDeviceEngine({
        modelPath,
        ...ON_DEVICE_DEFAULTS,
        ...LOCAL_MODEL_RUNTIME[profile],
      }),
    };
  }

  const degradedReason = !assessmentAllowsLocal
    ? 'The selected local profile is not supported by the attested device.'
    : !modelPath
      ? 'The on-device model has not been downloaded yet.'
      : !isOnDeviceSupported()
        ? 'The llama.rn native module is not present in this build.'
        : 'Local inference was not selected.';

  return {
    origin: 'stub',
    engine: createStubEngine(),
    degradedReason,
  };
}

export function createConnection(
  descriptor: EngineDescriptor,
): {
  connection: ConnectionAdapter;
  origin: EngineOrigin;
} {
  // The legacy TanStack text-stream transport is only used when its own URL is
  // explicitly configured; the AgentRuntime → /agent/step path never needs it.
  if (descriptor.origin === 'remote' && REMOTE_AI_BASE_URL) {
    return {
      origin: 'remote',
      connection: xhrHttpStream(`${REMOTE_AI_BASE_URL}/chat/http`),
    };
  }

  return {
    origin: descriptor.origin,
    connection: engineConnection(descriptor.engine, {
      systemPrompt: SYSTEM_PROMPT,
    }),
  };
}
