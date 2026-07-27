import Constants from 'expo-constants';
import Config from '../../../config/attestation.config';

/**
 * Resolves runtime configuration for the React Native client.
 *
 * IMPORTANT: `process.env.ATTESTATION_*` values are NOT available inside the
 * RN/Hermes bundle at runtime — babel-preset-expo only inlines `EXPO_PUBLIC_*`
 * variables. Reading `Config.serverBaseUrl` directly on-device therefore falls
 * back to `http://localhost:3000`, which points at the phone itself and makes
 * every network call fail with "Network request failed".
 *
 * `app.config.ts` bakes `AttestationConfig.public` into `expo.extra.attestation`
 * at build time (where `.env` IS loaded), so we read the real values from
 * `expo-constants` here, falling back to the compiled config only for the
 * Node/server context where `process.env` works.
 */
type AttestationExtra = {
  serverBaseUrl?: string;
  attestationDebug?: boolean;
  telegramBotUsername?: string;
};

const readExtra = (): AttestationExtra | undefined => {
  const fromExpoConfig = Constants.expoConfig?.extra?.attestation as
    | AttestationExtra
    | undefined;
  if (fromExpoConfig) {
    return fromExpoConfig;
  }
  // Fallback for updates/manifest2 runtime shape.
  const manifest2Extra = (
    Constants as unknown as {
      manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown> } } };
    }
  ).manifest2?.extra?.expoClient?.extra?.attestation as
    | AttestationExtra
    | undefined;
  return manifest2Extra;
};

const extra = readExtra();

export const serverBaseUrl: string =
  extra?.serverBaseUrl?.trim() || Config.serverBaseUrl;

export const attestationDebug: boolean =
  extra?.attestationDebug ?? Config.attestationDebug;

/** Bot username (no @) for deep-linking back into Telegram; '' if unconfigured. */
export const telegramBotUsername: string =
  extra?.telegramBotUsername?.trim().replace(/^@/u, '') ??
  Config.telegram.botUsername;
