import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { AttestationNativeProbes } from '@native/AttestationNativeProbes';
import {
  buildAttestationRequestMaterial,
} from '@attestation/shared/hash';

const sha256Base64Url = async (value: string): Promise<string> => {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
};

export const createAndroidHardwareKeyAttestation = async (input: {
  nonce: string;
  payloadHash: string;
  alias?: string;
}): Promise<
  | {
      alias: string;
      certificateChainBase64: string[];
      strongBoxBacked: boolean;
      strongBoxRequested?: boolean;
      strongBoxFallbackReason?: string;
    }
  | undefined
> => {
  if (Platform.OS !== 'android') return undefined;
  const challenge = await sha256Base64Url(
    buildAttestationRequestMaterial(input.nonce, input.payloadHash),
  );
  return AttestationNativeProbes.generateHardwareKeyAttestation(
    input.alias ?? 'attestation.high_value.v1',
    challenge,
  );
};
