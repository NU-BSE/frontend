import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  buildAttestationRequestMaterial,
} from '@attestation/shared/hash';
import type {
  AttestationTelemetry,
  BaseAttestationResult,
} from '@attestation/shared/wire';

const IOS_KEY_ID_STORAGE = 'attestation.ios.keyId.v1';
const IOS_REGISTERED_STORAGE = 'attestation.ios.registered.v1';

type AttestSessionParams = {
  nonce: string;
  payloadHash: string;
};

type PlayIntegrityAdapter = {
  requestIntegrityToken?: (input: {
    requestHash: string;
    nonce?: string;
  }) => Promise<string | { token: string }>;
  getIntegrityToken?: (input: {
    requestHash: string;
    nonce?: string;
  }) => Promise<string | { token: string }>;
  googleAttestation?: (nonce: string) => Promise<string | Uint8Array>;
  requestIntegrityTokenClassic?: (input: {
    nonce: string;
    googleCloudProjectNumber?: number;
  }) => Promise<string | { token: string }>;
};

type AppAttestAdapter = {
  isSupported?: () => Promise<boolean>;
  generateKey: () => Promise<string>;
  attestKey: (
    keyId: string,
    clientDataHash: string,
  ) => Promise<string | { attestation: string }>;
  generateAssertion: (
    keyId: string,
    clientDataHash: string,
  ) => Promise<string | { assertion: string }>;
  appleAttestation?: (
    keyId: string,
    clientDataHash: string,
  ) => Promise<string | Uint8Array>;
  appleAssertion?: (
    keyId: string,
    clientDataHash: string,
  ) => Promise<string | Uint8Array>;
};

// Metro/Hermes only allows static string literals in require(); a dynamic
// require(name) fails to bundle. Register each optional native module with a
// literal require so unavailable ones fall back to undefined at runtime.
// Note: only packages present in node_modules may be listed here — a static
// require of an uninstalled module fails at bundle time, so intentionally
// omitted modules (e.g. react-native-google-play-integrity) resolve to
// undefined via the missing-key path below.
const optionalModuleLoaders: Record<string, () => unknown> = {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  '@bifold/react-native-attestation': () =>
    require('@bifold/react-native-attestation'),
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  '@expo/app-integrity': () => require('@expo/app-integrity'),
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  'react-native-ios-appattest': () => require('react-native-ios-appattest'),
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  'react-native-app-attest': () => require('react-native-app-attest'),
};

const optionalRequire = <T>(name: string): T | undefined => {
  const loader = optionalModuleLoaders[name];
  if (!loader) {
    return undefined;
  }
  try {
    return loader() as T;
  } catch {
    return undefined;
  }
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const btoa = (globalThis as { btoa?: (value: string) => string }).btoa;
  if (!btoa) {
    throw new Error('No base64 encoder is available in this runtime');
  }
  return btoa(binary);
};

const sha256Base64Url = async (value: string): Promise<string> => {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
};

const record = async (
  telemetry: AttestationTelemetry | undefined,
  event: Parameters<AttestationTelemetry['record']>[0],
): Promise<void> => {
  await telemetry?.record(event);
};

const getPlayIntegrity = (): PlayIntegrityAdapter | undefined =>
  optionalRequire<PlayIntegrityAdapter>('@bifold/react-native-attestation') ??
  optionalRequire<PlayIntegrityAdapter>('@expo/app-integrity');

const requestPlayIntegrityStandard = async (
  requestHash: string,
): Promise<string> => {
  const adapter = getPlayIntegrity();
  if (adapter?.googleAttestation) {
    const response = await adapter.googleAttestation(requestHash);
    return typeof response === 'string'
      ? response
      : bytesToBase64(response);
  }
  const request =
    adapter?.requestIntegrityToken ?? adapter?.getIntegrityToken;
  if (!request) {
    throw new Error('GOOGLE_PLAY_INTEGRITY_UNAVAILABLE');
  }
  const response = await request({ requestHash, nonce: requestHash });
  return typeof response === 'string' ? response : response.token;
};

const requestPlayIntegrityClassic = async (
  requestHash: string,
): Promise<string> => {
  const adapter =
    getPlayIntegrity() ??
    optionalRequire<PlayIntegrityAdapter>('react-native-google-play-integrity');
  const request = adapter?.requestIntegrityTokenClassic;
  if (!request) {
    throw new Error('GOOGLE_PLAY_INTEGRITY_CLASSIC_UNAVAILABLE');
  }
  const response = await request({ nonce: requestHash });
  return typeof response === 'string' ? response : response.token;
};

const getAppAttest = (): AppAttestAdapter | undefined =>
  optionalRequire<AppAttestAdapter>('@bifold/react-native-attestation') ??
  optionalRequire<AppAttestAdapter>('react-native-ios-appattest') ??
  optionalRequire<AppAttestAdapter>('react-native-app-attest');

const unwrapBlob = (
  value: string | { attestation?: string; assertion?: string },
  key: 'attestation' | 'assertion',
): string => (typeof value === 'string' ? value : value[key] ?? '');

const encodeNativeBlob = (
  value: string | Uint8Array | { attestation?: string; assertion?: string },
  key: 'attestation' | 'assertion',
): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return bytesToBase64(value);
  return value[key] ?? '';
};

const attestAndroid = async (
  requestHash: string,
): Promise<BaseAttestationResult> => {
  try {
    const token = await requestPlayIntegrityStandard(requestHash);
    return {
      ok: true,
      platform: 'android',
      token,
      provider: 'playIntegrity',
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    if (details.includes('GOOGLE_PLAY_INTEGRITY_UNAVAILABLE')) {
      try {
        const token = await requestPlayIntegrityClassic(requestHash);
        return {
          ok: true,
          platform: 'android',
          token,
          provider: 'playIntegrity',
        };
      } catch (classicError) {
        return {
          ok: false,
          code: 'INTEGRITY_SERVICE_UNAVAILABLE',
          retryable: true,
          details:
            classicError instanceof Error
              ? classicError.message
              : String(classicError),
        };
      }
    }
    return {
      ok: false,
      code:
        details.includes('UNAVAILABLE') || details.includes('PLAY')
          ? 'INTEGRITY_SERVICE_UNAVAILABLE'
          : 'UNKNOWN',
      retryable:
        details.includes('NETWORK') || details.includes('UNAVAILABLE'),
      details,
    };
  }
};

const attestIos = async (
  clientDataHash: string,
): Promise<BaseAttestationResult> => {
  const adapter = getAppAttest();
  if (!adapter) {
    return {
      ok: false,
      code: 'DEVICE_NOT_SUPPORTED',
      retryable: false,
      details: 'No App Attest native binding is installed',
    };
  }

  try {
    const supported = await adapter.isSupported?.();
    if (supported === false) {
      return {
        ok: false,
        code: 'DEVICE_NOT_SUPPORTED',
        retryable: false,
      };
    }

    let keyId = await SecureStore.getItemAsync(IOS_KEY_ID_STORAGE);
    if (!keyId) {
      keyId = await adapter.generateKey();
      await SecureStore.setItemAsync(IOS_KEY_ID_STORAGE, keyId);
    }

    const registered =
      (await SecureStore.getItemAsync(IOS_REGISTERED_STORAGE)) === 'true';
    if (!registered) {
      const attestationValue = adapter.appleAttestation
        ? await adapter.appleAttestation(keyId, clientDataHash)
        : await adapter.attestKey(keyId, clientDataHash);
      const attestation = encodeNativeBlob(attestationValue, 'attestation');
      await SecureStore.setItemAsync(IOS_REGISTERED_STORAGE, 'true');
      return {
        ok: true,
        platform: 'ios',
        assertion: '',
        keyId,
        attestation,
        provider: 'appAttest',
      };
    }

    const assertionValue = adapter.appleAssertion
      ? await adapter.appleAssertion(keyId, clientDataHash)
      : await adapter.generateAssertion(keyId, clientDataHash);
    const assertion = encodeNativeBlob(assertionValue, 'assertion');
    return {
      ok: true,
      platform: 'ios',
      assertion,
      keyId,
      provider: 'appAttest',
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: details.toLowerCase().includes('key')
        ? 'KEY_GENERATION_FAILED'
        : 'ASSERTION_FAILED',
      retryable: !details.toLowerCase().includes('unsupported'),
      details,
    };
  }
};

export const attestSession = async (
  params: AttestSessionParams,
  telemetry?: AttestationTelemetry,
): Promise<BaseAttestationResult> => {
  const startedAtMs = Date.now();
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  await record(telemetry, {
    name: 'attestation.start',
    platform,
    startedAtMs,
  });

  const requestHash = await sha256Base64Url(
    buildAttestationRequestMaterial(params.nonce, params.payloadHash),
  );
  const result =
    platform === 'ios'
      ? await attestIos(requestHash)
      : await attestAndroid(requestHash);

  const endedAtMs = Date.now();
  await record(telemetry, {
    name: 'attestation.end',
    platform,
    startedAtMs,
    endedAtMs,
    durationMs: endedAtMs - startedAtMs,
    ok: result.ok,
    ...(result.ok ? {} : { code: result.code }),
  });

  return result;
};
