import { createHash, randomBytes } from 'node:crypto';
import {
  buildAttestationRequestMaterial,
} from '@attestation/shared/hash';

export const sha256Hex = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

export const sha256Base64Url = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('base64url');

export const randomNonce = (): string => randomBytes(32).toString('base64url');

export const computePayloadHash = (canonicalJson: string): string =>
  sha256Hex(canonicalJson).toLowerCase();

export const computeAttestationRequestHash = (
  nonce: string,
  payloadHash: string,
): string =>
  sha256Base64Url(buildAttestationRequestMaterial(nonce, payloadHash));
