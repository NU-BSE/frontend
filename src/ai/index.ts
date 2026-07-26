import { xhrHttpStream } from '@tanstack/ai-client';
import type { ConnectionAdapter } from '@tanstack/ai-client';

import {
  FORCED_ENGINE,
  ON_DEVICE_DEFAULTS,
  ON_DEVICE_MODEL_PATH,
  REMOTE_AI_BASE_URL,
  SYSTEM_PROMPT,
} from './config';
import { engineConnection } from './engineConnection';
import { createOnDeviceEngine, isOnDeviceSupported } from './engines/onDeviceEngine';
import { createStubEngine } from './engines/stubEngine';
import type { EngineDescriptor, EngineOrigin } from './types';

export * from './types';
export { engineConnection } from './engineConnection';
export { isOnDeviceSupported } from './engines/onDeviceEngine';

/**
 * Choose an engine.
 *
 * Order is deliberate: on-device first, because the product promise is that
 * text does not leave the phone. Remote is a fallback only, and the stub is
 * the floor so the app is never dead in the water.
 */
export function resolveEngine(): EngineDescriptor {
  const canRunOnDevice =
    Boolean(ON_DEVICE_MODEL_PATH) && isOnDeviceSupported();

  const wants = FORCED_ENGINE || (canRunOnDevice ? 'on-device' : 'stub');

  if (wants === 'on-device' && canRunOnDevice) {
    return {
      origin: 'on-device',
      engine: createOnDeviceEngine({
        modelPath: ON_DEVICE_MODEL_PATH,
        ...ON_DEVICE_DEFAULTS,
      }),
    };
  }

  return { origin: 'stub', engine: createStubEngine() };
}

/**
 * The connection handed to `useChat`.
 *
 * Remote mode returns TanStack AI's own XHR adapter — `xhrHttpStream` is the
 * documented choice for React Native, where `fetch` streaming is unreliable.
 * Every other mode runs through the in-process engine bridge.
 */
export function createConnection(descriptor: EngineDescriptor): {
  connection: ConnectionAdapter;
  origin: EngineOrigin;
} {
  if (FORCED_ENGINE === 'remote' && REMOTE_AI_BASE_URL) {
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
