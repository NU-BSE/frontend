import { Platform } from 'react-native';

import {
  AttestationNativeProbes,
  type AndroidKeySecurityLevel,
  type HardwareEncryptedPayload,
  type HardwareKeyAttestation,
} from '../native/AttestationNativeProbes';

export const DEVICE_IDENTITY_KEY_ALIAS = 'creepyim.device.identity.v1';
export const LOCAL_SECRET_KEY_ALIAS = 'creepyim.local.secrets.v1';

export type DeviceIdentityProof = {
  mode: 'new-key-attestation' | 'existing-key-possession';
  attestation: HardwareKeyAttestation;
  challengeSignatureBase64: string;
  signatureAlgorithm: 'SHA256withECDSA';
  challengeDomain: 'creepyim-device-challenge-v1';
};

export type ServerAttestationVerdict = {
  schemaVersion: 1;
  verified: boolean;
  securityLevel: AndroidKeySecurityLevel;
  challengeValid: boolean;
  certificateChainTrusted: boolean;
  revocationChecked: boolean;
  appIdentityValid: boolean;
  verifiedBoot: boolean;
  deviceLocked: boolean;
  policyVersion: string;
  verifiedAtMs: number;
  reasons: string[];
};

const requireAndroid = (): void => {
  if (Platform.OS !== 'android') {
    throw new Error('Android Keystore operations are available only on Android.');
  }
};

const requireBase64Value = (label: string, value: string): void => {
  if (!value || !/^[A-Za-z0-9+/_=-]+$/u.test(value)) {
    throw new Error(`${label} must be a non-empty Base64 value.`);
  }
};

/**
 * Creates the persistent device identity key once and returns proof of
 * possession for every server challenge.
 *
 * A server can accept `new-key-attestation` only after validating the complete
 * certificate chain and attestation challenge. For `existing-key-possession`,
 * it must already have the public key registered and verify the challenge
 * signature against that key.
 */
export async function prepareDeviceIdentityProof(
  serverChallengeBase64: string,
): Promise<DeviceIdentityProof> {
  requireAndroid();
  requireBase64Value('serverChallengeBase64', serverChallengeBase64);

  const attestation =
    await AttestationNativeProbes.generateHardwareKeyAttestation(
      DEVICE_IDENTITY_KEY_ALIAS,
      serverChallengeBase64,
    );
  const signature = await AttestationNativeProbes.signDeviceChallenge(
    DEVICE_IDENTITY_KEY_ALIAS,
    serverChallengeBase64,
  );

  return {
    mode:
      attestation.created && attestation.challengeApplied
        ? 'new-key-attestation'
        : 'existing-key-possession',
    attestation,
    challengeSignatureBase64: signature.signatureBase64,
    signatureAlgorithm: signature.signatureAlgorithm,
    challengeDomain: signature.challengeDomain,
  };
}

/** Encrypts Base64-encoded secret bytes with a non-exportable AES-GCM key. */
export async function encryptLocalSecret(
  plaintextBase64: string,
): Promise<HardwareEncryptedPayload> {
  requireAndroid();
  requireBase64Value('plaintextBase64', plaintextBase64);
  return AttestationNativeProbes.encryptWithHardwareAesKey(
    LOCAL_SECRET_KEY_ALIAS,
    plaintextBase64,
  );
}

/** Decrypts a payload produced by encryptLocalSecret. */
export async function decryptLocalSecret(
  payload: Pick<HardwareEncryptedPayload, 'ciphertextBase64' | 'ivBase64'>,
): Promise<string> {
  requireAndroid();
  requireBase64Value('ciphertextBase64', payload.ciphertextBase64);
  requireBase64Value('ivBase64', payload.ivBase64);
  const result = await AttestationNativeProbes.decryptWithHardwareAesKey(
    LOCAL_SECRET_KEY_ALIAS,
    payload.ciphertextBase64,
    payload.ivBase64,
  );
  return result.plaintextBase64;
}

export function isServerAttestationTrusted(
  verdict: ServerAttestationVerdict | null | undefined,
): verdict is ServerAttestationVerdict {
  return Boolean(
    verdict?.verified &&
      verdict.challengeValid &&
      verdict.certificateChainTrusted &&
      verdict.revocationChecked &&
      verdict.appIdentityValid &&
      verdict.verifiedBoot &&
      verdict.deviceLocked &&
      (verdict.securityLevel === 'trustedEnvironment' ||
        verdict.securityLevel === 'strongBox'),
  );
}
