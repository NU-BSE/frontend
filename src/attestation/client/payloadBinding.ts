import * as Crypto from 'expo-crypto';
import type { BoundPayload, SensitiveAction } from '@attestation/shared/wire';

const MAX_CANONICAL_BYTES = 4 * 1024;

type JcsModule = {
  canonicalize?: (value: unknown) => string;
  default?: (value: unknown) => string;
};

const getCanonicalizer = async (): Promise<(value: unknown) => string> => {
  const module = (await import('json-canonicalize')) as unknown as JcsModule;
  const canonicalize = module.canonicalize ?? module.default;
  if (!canonicalize) {
    throw new Error('json-canonicalize did not expose a canonicalizer');
  }
  return canonicalize;
};

const utf8ByteLength = (value: string): number =>
  encodeURIComponent(value).replace(/%[0-9A-F]{2}/giu, 'x').length;

export const bindPayload = async (
  action: SensitiveAction,
): Promise<BoundPayload> => {
  const canonicalize = await getCanonicalizer();
  const canonicalJson = canonicalize(action);
  if (utf8ByteLength(canonicalJson) > MAX_CANONICAL_BYTES) {
    throw new Error('Canonical sensitive action exceeds 4 KB');
  }

  const payloadHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonicalJson,
    { encoding: Crypto.CryptoEncoding.HEX },
  );

  return {
    canonicalJson,
    payloadHash: payloadHash.toLowerCase(),
  };
};
