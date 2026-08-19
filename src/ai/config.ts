/**
 * Runtime AI configuration.
 *
 * All values are build-time public (EXPO_PUBLIC_*) because nothing here is a
 * secret: the on-device path holds no credentials, and the remote path is a
 * base URL whose server owns its own keys. No API key ever enters the bundle.
 *
 * Every read below is written as a literal `process.env.EXPO_PUBLIC_*` member
 * expression, and has to stay that way. Metro substitutes these at build time
 * by matching that exact syntax; through an alias (`const env = process.env`)
 * or a destructure the match fails, nothing is substituted, and the value is
 * `undefined` in a release bundle. Development hides this — the dev runtime
 * carries a populated `process.env` — so the app only fails once installed,
 * which is how a store build came to report the backend as unconfigured.
 */

/** Absolute path / `file://` URI to a GGUF model shipped or downloaded to the device. */
export const ON_DEVICE_MODEL_PATH =
  process.env.EXPO_PUBLIC_LLM_MODEL_PATH?.trim() || '';

/**
 * Canonical Creepy.IM backend origin. This is the single source of truth for
 * the remote Agent backend (`POST /agent/step`) — presence of this value
 * (for `cloud` / `remote` engine selection) is what enables `origin: remote`.
 */
export const BACKEND_API_URL = process.env.EXPO_PUBLIC_API_URL?.trim() || '';

/**
 * Optional legacy TanStack AI text-stream endpoint. Only used for the raw
 * `useChat` stream transport; the AgentRuntime → /agent/step path does NOT
 * depend on it.
 */
export const REMOTE_AI_BASE_URL =
  process.env.EXPO_PUBLIC_TANSTACK_AI_BASE_URL?.trim() || '';

/** Forces a specific engine during development. */
export const FORCED_ENGINE = (process.env.EXPO_PUBLIC_LLM_ENGINE?.trim() || '') as
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
