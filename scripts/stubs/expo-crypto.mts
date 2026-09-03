/**
 * expo-crypto for verification scripts, backed by Node's own SHA-256.
 *
 * A no-op stub would make the integrity check untestable, which is the one
 * part of the bundle store worth testing. This hashes for real, so a script
 * can assert that the app computes the same digest the backend published —
 * both over the UTF-8 bytes of the same string.
 */
import { createHash } from 'node:crypto';

export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' } as const;
export const CryptoEncoding = { HEX: 'hex', BASE64: 'base64' } as const;

export async function digestStringAsync(
  _algorithm: string,
  data: string,
  options?: { encoding?: string },
): Promise<string> {
  return createHash('sha256')
    .update(data, 'utf8')
    .digest((options?.encoding as 'hex' | 'base64') ?? 'hex');
}
