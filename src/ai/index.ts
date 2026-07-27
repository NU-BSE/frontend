import { xhrHttpStream } from '@tanstack/ai-client';
import type { ConnectionAdapter } from '@tanstack/ai-client';

import type { DeviceAssessment } from '@/attestation/client/deviceAssessment';
import type { MemoryProfile } from '@/storage/prefs';
import {
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

export function resolveEngine(selection: EngineSelection): EngineDescriptor {
  if (FORCED_ENGINE === 'stub') {
    return { origin: 'stub', engine: createStubEngine() };
  }

  const profile = selection.memoryProfile;
  if (profile === 'cloud' || FORCED_ENGINE === 'remote') {
    return {
      origin: 'stub',
      engine: createStubEngine(),
      ...(!REMOTE_AI_BASE_URL
        ? { degradedReason: 'Remote AI endpoint is not configured.' }
        : {}),
    };
  }

  const modelPath = LOCAL_MODEL_PATHS[profile];
  const assessmentAllowsLocal = canUseLocalProfile(
    profile,
    selection.assessment,
  );
  const canRunOnDevice =
    assessmentAllowsLocal && Boolean(modelPath) && isOnDeviceSupported();

  if ((FORCED_ENGINE === 'on-device' || !FORCED_ENGINE) && canRunOnDevice) {
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
      ? `No GGUF path is configured for the ${profile} profile.`
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
  selection: EngineSelection,
): {
  connection: ConnectionAdapter;
  origin: EngineOrigin;
} {
  if (
    (selection.memoryProfile === 'cloud' || FORCED_ENGINE === 'remote') &&
    REMOTE_AI_BASE_URL
  ) {
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
