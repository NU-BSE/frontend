export const ATTESTATION_HASH_ALGORITHM = 'SHA-256';

export const buildAttestationRequestMaterial = (
  nonce: string,
  payloadHash: string,
): string => `${nonce}${payloadHash}`;

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
