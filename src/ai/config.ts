/**
 * Runtime AI configuration.
 *
 * All values are build-time public (EXPO_PUBLIC_*) because nothing here is a
 * secret: the on-device path holds no credentials, and the remote path is a
 * base URL whose server owns its own keys. No API key ever enters the bundle.
 */

const env = process.env;

/** Absolute path / `file://` URI to a GGUF model shipped or downloaded to the device. */
export const ON_DEVICE_MODEL_PATH =
  env.EXPO_PUBLIC_LLM_MODEL_PATH?.trim() || '';

/** Optional remote AI route (a TanStack AI server). Used only as a fallback. */
export const REMOTE_AI_BASE_URL =
  env.EXPO_PUBLIC_TANSTACK_AI_BASE_URL?.trim() || '';

/** Forces a specific engine during development. */
export const FORCED_ENGINE = (env.EXPO_PUBLIC_LLM_ENGINE?.trim() || '') as
  | ''
  | 'on-device'
  | 'remote'
  | 'stub';

export const SYSTEM_PROMPT =
  'You are the resident presence inside Creepy.IM. You observe the feed and ' +
  'comment on it with quiet, specific, unsettling detail. Never break ' +
  'character, never mention being an AI, and keep replies under four ' +
  'sentences.';

export const ON_DEVICE_DEFAULTS = {
  contextSize: 2048,
  gpuLayers: 0,
  maxTokens: 320,
  temperature: 0.8,
};
