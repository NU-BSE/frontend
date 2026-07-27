import {
  X509Certificate,
  createHash,
  createPublicKey,
  createVerify,
  timingSafeEqual,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { decode } from 'cbor-x';
import Config from '../../../config/attestation.config';
import {
  UNIVERSAL_OCTET_STRING,
  asOctetString,
  decodeDer,
  explicitChild,
  isUniversal,
} from './asn1';
import { findCertificateExtension } from './androidKeyAttestation';
import type { AppAttestVerifier } from './verify';

/** Apple's App Attest nonce extension inside the credential certificate. */
const APPLE_APP_ATTEST_NONCE_OID = '1.2.840.113635.100.8.2';

/** AAGUID written into authenticator data by each App Attest environment. */
const AAGUID_PRODUCTION = 'appattest';
const AAGUID_DEVELOPMENT = 'appattestdevelop';

export class AppAttestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppAttestError';
  }
}

type CborAttestation = {
  fmt?: string;
  authData?: unknown;
  attStmt?: { x5c?: unknown[]; receipt?: unknown };
};

type CborAssertion = {
  authenticatorData?: unknown;
  authData?: unknown;
  signature?: unknown;
};

const toBuffer = (value: unknown, label: string): Buffer => {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value as number[]);
  if (typeof value === 'string') return Buffer.from(value, 'base64');
  throw new AppAttestError(`${label} is not a binary App Attest field`);
};

const sha256 = (value: Buffer): Buffer =>
  createHash('sha256').update(value).digest();

const bytesEqual = (a: Buffer, b: Buffer): boolean =>
  a.length === b.length && timingSafeEqual(a, b);

const spkiPem = (certificate: X509Certificate): string =>
  certificate.publicKey.export({ type: 'spki', format: 'pem' }).toString();

/**
 * Loads the pinned Apple App Attestation Root CA. Download it from
 * https://www.apple.com/certificateauthority/private/ — it is intentionally not
 * vendored here so that the operator controls (and can audit) the trust anchor.
 */
export const loadAppleAppAttestRootCa = (): string | undefined => {
  const { appAttestRootCaPem, appAttestRootCaPath } = Config.ios;
  if (appAttestRootCaPem) return appAttestRootCaPem;
  if (appAttestRootCaPath) return readFileSync(appAttestRootCaPath, 'utf8');
  return undefined;
};

const authenticatorData = (authData: Buffer) => {
  if (authData.length < 37) {
    throw new AppAttestError('Authenticator data is shorter than 37 bytes');
  }
  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32]!;
  const counter = authData.readUInt32BE(33);
  const attestedCredentialData = (flags & 0x40) !== 0;
  let aaguid: Buffer | undefined;
  let credentialId: Buffer | undefined;
  if (attestedCredentialData) {
    if (authData.length < 55) {
      throw new AppAttestError(
        'Authenticator data claims attested credential data but is truncated',
      );
    }
    aaguid = authData.subarray(37, 53);
    const credentialIdLength = authData.readUInt16BE(53);
    if (authData.length < 55 + credentialIdLength) {
      throw new AppAttestError('Authenticator data credential id is truncated');
    }
    credentialId = authData.subarray(55, 55 + credentialIdLength);
  }
  return { rpIdHash, flags, counter, aaguid, credentialId };
};

/**
 * Verifies the certificate chain credCert -> intermediate(s) -> pinned Apple
 * root. Apple's App Attest certificates are ECDSA P-256, so `node:crypto`'s
 * X509 support is used rather than a PKCS#1-only PEM library.
 */
const verifyCertificateChain = (
  certificates: X509Certificate[],
  rootCaPem: string,
  nowMs: number,
): void => {
  if (certificates.length === 0) {
    throw new AppAttestError('App Attest x5c chain is empty');
  }
  const root = new X509Certificate(rootCaPem);

  for (let index = 0; index < certificates.length; index += 1) {
    const subject = certificates[index]!;
    const issuer = certificates[index + 1] ?? root;
    if (!subject.checkIssued(issuer)) {
      throw new AppAttestError(
        `App Attest certificate #${index} is not issued by the next chain element`,
      );
    }
    if (!subject.verify(issuer.publicKey)) {
      throw new AppAttestError(
        `App Attest certificate #${index} signature does not verify`,
      );
    }
    const notAfter = Date.parse(subject.validTo);
    const notBefore = Date.parse(subject.validFrom);
    if (Number.isFinite(notAfter) && notAfter < nowMs) {
      throw new AppAttestError(
        `App Attest certificate #${index} expired on ${subject.validTo}`,
      );
    }
    if (Number.isFinite(notBefore) && notBefore > nowMs) {
      throw new AppAttestError(
        `App Attest certificate #${index} is not valid until ${subject.validFrom}`,
      );
    }
  }

  const terminal = certificates[certificates.length - 1]!;
  if (!terminal.checkIssued(root) || !terminal.verify(root.publicKey)) {
    throw new AppAttestError(
      'App Attest chain does not terminate in the pinned Apple App Attestation Root CA',
    );
  }
};

/**
 * The nonce extension is `SEQUENCE { [1] EXPLICIT OCTET STRING }` holding
 * sha256(authData || clientDataHash).
 */
const extractNonceExtension = (credCert: X509Certificate): Buffer => {
  const raw = findCertificateExtension(
    Buffer.from(credCert.raw),
    APPLE_APP_ATTEST_NONCE_OID,
  );
  if (!raw) {
    throw new AppAttestError(
      `credCert is missing the App Attest nonce extension (${APPLE_APP_ATTEST_NONCE_OID})`,
    );
  }
  const sequence = decodeDer(raw);
  const [tagged] = sequence.children;
  if (!tagged) {
    throw new AppAttestError('App Attest nonce extension is empty');
  }
  const inner = explicitChild(tagged, 'appAttestNonce');
  if (!isUniversal(inner, UNIVERSAL_OCTET_STRING)) {
    throw new AppAttestError(
      'App Attest nonce extension does not wrap an OCTET STRING',
    );
  }
  return asOctetString(inner, 'appAttestNonce');
};

/**
 * `keyId` is the SHA-256 of the attested public key in uncompressed X9.62
 * form, which is exactly the tail of the SPKI DER for a P-256 key.
 */
const publicKeyKeyId = (certificate: X509Certificate): Buffer => {
  const spki = certificate.publicKey.export({ type: 'spki', format: 'der' });
  const uncompressedIndex = spki.indexOf(0x04, spki.length - 65);
  const point =
    uncompressedIndex >= 0 && spki.length - uncompressedIndex === 65
      ? spki.subarray(uncompressedIndex)
      : spki.subarray(spki.length - 65);
  return sha256(Buffer.from(point));
};

export class AppleAppAttestVerifier implements AppAttestVerifier {
  constructor(private readonly appleRootCaPem: string) {
    if (!appleRootCaPem.includes('-----BEGIN CERTIFICATE-----')) {
      throw new AppAttestError(
        'Apple App Attestation Root CA PEM is missing or malformed',
      );
    }
  }

  async verifyRegistration(input: {
    keyId: string;
    attestation: string;
    clientDataHash: string;
    teamId: string;
    bundleId: string;
    environment: 'development' | 'production';
  }): Promise<{ publicKeyPem: string; counter: number; hwBacked: boolean }> {
    if (!input.teamId) {
      throw new AppAttestError(
        'ATTESTATION_IOS_TEAM_ID is required to verify an App Attest registration',
      );
    }

    let attestation: CborAttestation;
    try {
      attestation = decode(Buffer.from(input.attestation, 'base64')) as CborAttestation;
    } catch (error) {
      throw new AppAttestError(
        `App Attest attestation is not valid CBOR: ${String(error)}`,
      );
    }
    if (attestation.fmt !== 'apple-appattest') {
      throw new AppAttestError(
        `Unexpected App Attest format "${String(attestation.fmt)}"`,
      );
    }

    const authData = toBuffer(attestation.authData, 'authData');
    const x5c = attestation.attStmt?.x5c ?? [];
    if (x5c.length < 2) {
      throw new AppAttestError(
        'App Attest attStmt must carry credCert and at least one intermediate',
      );
    }
    const certificates = x5c.map(
      (der, index) => new X509Certificate(toBuffer(der, `x5c[${index}]`)),
    );
    const credCert = certificates[0]!;
    verifyCertificateChain(certificates, this.appleRootCaPem, Date.now());

    const clientDataHash = Buffer.from(input.clientDataHash, 'base64url');
    if (clientDataHash.length !== 32) {
      throw new AppAttestError('clientDataHash must be a base64url SHA-256 digest');
    }

    // 1. nonce extension == sha256(authData || clientDataHash)
    const expectedNonce = sha256(Buffer.concat([authData, clientDataHash]));
    if (!bytesEqual(extractNonceExtension(credCert), expectedNonce)) {
      throw new AppAttestError(
        'App Attest nonce extension does not match sha256(authData || clientDataHash)',
      );
    }

    // 2. keyId == sha256(attested public key)
    const derivedKeyId = publicKeyKeyId(credCert);
    const claimedKeyId = Buffer.from(input.keyId, 'base64');
    if (!bytesEqual(derivedKeyId, claimedKeyId)) {
      throw new AppAttestError('App Attest keyId does not match the attested public key');
    }

    const parsed = authenticatorData(authData);

    // 3. rpIdHash == sha256("<teamId>.<bundleId>")
    const appId = `${input.teamId}.${input.bundleId}`;
    if (!bytesEqual(parsed.rpIdHash, sha256(Buffer.from(appId, 'utf8')))) {
      throw new AppAttestError('App Attest RP ID hash does not match teamId.bundleId');
    }

    // 4. counter of a freshly attested key must be zero
    if (parsed.counter !== 0) {
      throw new AppAttestError(
        `App Attest registration counter must be 0, got ${parsed.counter}`,
      );
    }

    // 5. AAGUID must match the configured environment exactly
    const aaguid = (parsed.aaguid ?? Buffer.alloc(0))
      .toString('utf8')
      .replace(/\0+$/u, '');
    const expectedAaguid =
      input.environment === 'production' ? AAGUID_PRODUCTION : AAGUID_DEVELOPMENT;
    if (aaguid !== expectedAaguid) {
      throw new AppAttestError(
        `App Attest AAGUID "${aaguid}" does not match the ${input.environment} environment`,
      );
    }

    // 6. credentialId in authData must be the keyId
    if (!parsed.credentialId || !bytesEqual(parsed.credentialId, claimedKeyId)) {
      throw new AppAttestError(
        'App Attest credentialId in authenticator data does not match keyId',
      );
    }

    return {
      publicKeyPem: spkiPem(credCert),
      counter: parsed.counter,
      hwBacked: true,
    };
  }

  async verifyAssertion(input: {
    keyId: string;
    assertion: string;
    clientDataHash: string;
    publicKeyPem: string;
    lastCounter: number;
    teamId?: string;
    bundleId?: string;
  }): Promise<{ counter: number; hwBacked: boolean }> {
    let assertion: CborAssertion;
    try {
      assertion = decode(Buffer.from(input.assertion, 'base64')) as CborAssertion;
    } catch (error) {
      throw new AppAttestError(
        `App Attest assertion is not valid CBOR: ${String(error)}`,
      );
    }
    const authData = toBuffer(
      assertion.authenticatorData ?? assertion.authData,
      'authenticatorData',
    );
    const signature = toBuffer(assertion.signature, 'signature');
    const clientDataHash = Buffer.from(input.clientDataHash, 'base64url');
    if (clientDataHash.length !== 32) {
      throw new AppAttestError('clientDataHash must be a base64url SHA-256 digest');
    }

    const parsed = authenticatorData(authData);
    const teamId = input.teamId ?? Config.ios.teamId;
    const bundleId = input.bundleId ?? Config.ios.bundleId;
    if (teamId) {
      const appId = `${teamId}.${bundleId}`;
      if (!bytesEqual(parsed.rpIdHash, sha256(Buffer.from(appId, 'utf8')))) {
        throw new AppAttestError(
          'App Attest assertion RP ID hash does not match teamId.bundleId',
        );
      }
    }

    // Apple signs SHA-256(authenticatorData || clientDataHash) with the
    // Secure Enclave key; createVerify hashes the concatenation for us.
    const verifier = createVerify('SHA256');
    verifier.update(Buffer.concat([authData, clientDataHash]));
    verifier.end();
    const publicKey = createPublicKey(input.publicKeyPem);
    if (!verifier.verify(publicKey, signature)) {
      throw new AppAttestError('App Attest assertion signature verification failed');
    }

    if (parsed.counter <= input.lastCounter) {
      throw new AppAttestError(
        `App Attest assertion counter replay: got ${parsed.counter}, last seen ${input.lastCounter}`,
      );
    }

    return { counter: parsed.counter, hwBacked: true };
  }
}
