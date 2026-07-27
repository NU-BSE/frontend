import { X509Certificate, createHash, timingSafeEqual } from 'node:crypto';
import {
  Asn1Error,
  asBoolean,
  asInteger,
  asOctetString,
  asOid,
  decodeDer,
  expectUniversal,
  explicitChild,
  isUniversal,
  TAG_CLASS_CONTEXT,
  UNIVERSAL_ENUMERATED,
  UNIVERSAL_INTEGER,
  UNIVERSAL_NULL,
  UNIVERSAL_OCTET_STRING,
  UNIVERSAL_SEQUENCE,
  UNIVERSAL_SET,
  type Asn1Node,
} from './asn1';

/** X.509 extension carrying the Android Key Description. */
export const ANDROID_KEY_ATTESTATION_OID = '1.3.6.1.4.1.11129.2.1.17';

export type AttestationSecurityLevel =
  | 'SOFTWARE'
  | 'TRUSTED_ENVIRONMENT'
  | 'STRONG_BOX';

export type VerifiedBootState =
  | 'VERIFIED'
  | 'SELF_SIGNED'
  | 'UNVERIFIED'
  | 'FAILED';

export type RootOfTrust = {
  verifiedBootKeyBase64: string;
  deviceLocked: boolean;
  verifiedBootState: VerifiedBootState;
  verifiedBootHashBase64?: string;
};

export type AuthorizationList = {
  purposes?: number[];
  algorithm?: number;
  keySize?: number;
  digests?: number[];
  ecCurve?: number;
  noAuthRequired?: boolean;
  unlockedDeviceRequired?: boolean;
  rollbackResistance?: boolean;
  earlyBootOnly?: boolean;
  creationDateTimeMs?: number;
  origin?: number;
  rootOfTrust?: RootOfTrust;
  /** Raw MMmmuu encoding, e.g. 150000 for Android 15. */
  osVersion?: number;
  /** Human-readable form of `osVersion`, e.g. "15.0.0". */
  osVersionText?: string;
  /** Raw YYYYMM encoding, e.g. 202506. */
  osPatchLevel?: number;
  /** First day of the patch month as an ISO date, e.g. "2025-06-01". */
  osPatchLevelDate?: string;
  /** Raw YYYYMMDD encoding. */
  bootPatchLevel?: number;
  /** Raw YYYYMM encoding. */
  vendorPatchLevel?: number;
  attestationIdBrand?: string;
  attestationIdDevice?: string;
  attestationIdProduct?: string;
  attestationIdManufacturer?: string;
  attestationIdModel?: string;
  deviceUniqueAttestation?: boolean;
  /** Tags present in the list that this parser does not model, for diagnostics. */
  unknownTags: number[];
};

export type KeyDescription = {
  attestationVersion: number;
  attestationSecurityLevel: AttestationSecurityLevel;
  keymasterVersion: number;
  keymasterSecurityLevel: AttestationSecurityLevel;
  attestationChallenge: Buffer;
  uniqueId: Buffer;
  softwareEnforced: AuthorizationList;
  hardwareEnforced: AuthorizationList;
};

export class KeyAttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyAttestationError';
  }
}

// ---------------------------------------------------------------------------
// KeyDescription ASN.1 decoding
// ---------------------------------------------------------------------------

const SECURITY_LEVELS: Record<number, AttestationSecurityLevel> = {
  0: 'SOFTWARE',
  1: 'TRUSTED_ENVIRONMENT',
  2: 'STRONG_BOX',
};

const VERIFIED_BOOT_STATES: Record<number, VerifiedBootState> = {
  0: 'VERIFIED',
  1: 'SELF_SIGNED',
  2: 'UNVERIFIED',
  3: 'FAILED',
};

/**
 * Strict decode of `SecurityLevel ::= ENUMERATED { Software(0),
 * TrustedEnvironment(1), StrongBox(2) }`. An unknown value is an error, never a
 * silent downgrade to SOFTWARE.
 */
const decodeSecurityLevel = (
  node: Asn1Node,
  label: string,
): AttestationSecurityLevel => {
  if (!isUniversal(node, UNIVERSAL_ENUMERATED)) {
    throw new KeyAttestationError(`${label} must be an ENUMERATED value`);
  }
  const raw = asInteger(node, label);
  const level = SECURITY_LEVELS[raw];
  if (!level) {
    throw new KeyAttestationError(`${label} has unknown SecurityLevel ${raw}`);
  }
  return level;
};

const decodeVerifiedBootState = (node: Asn1Node): VerifiedBootState => {
  if (!isUniversal(node, UNIVERSAL_ENUMERATED)) {
    throw new KeyAttestationError('verifiedBootState must be an ENUMERATED value');
  }
  const raw = asInteger(node, 'verifiedBootState');
  const state = VERIFIED_BOOT_STATES[raw];
  if (!state) {
    throw new KeyAttestationError(
      `verifiedBootState has unknown value ${raw}`,
    );
  }
  return state;
};

/**
 * RootOfTrust ::= SEQUENCE {
 *   verifiedBootKey    OCTET_STRING,
 *   deviceLocked       BOOLEAN,
 *   verifiedBootState  VerifiedBootState,
 *   verifiedBootHash   OCTET_STRING  -- attestation version >= 3
 * }
 */
const decodeRootOfTrust = (node: Asn1Node): RootOfTrust => {
  expectUniversal(node, UNIVERSAL_SEQUENCE, 'rootOfTrust');
  const [keyNode, lockedNode, stateNode, hashNode, ...rest] = node.children;
  if (!keyNode || !lockedNode || !stateNode) {
    throw new KeyAttestationError('rootOfTrust is missing required fields');
  }
  if (rest.length > 0) {
    throw new KeyAttestationError('rootOfTrust has unexpected trailing fields');
  }
  const rootOfTrust: RootOfTrust = {
    verifiedBootKeyBase64: asOctetString(keyNode, 'verifiedBootKey').toString(
      'base64',
    ),
    deviceLocked: asBoolean(lockedNode, 'deviceLocked'),
    verifiedBootState: decodeVerifiedBootState(stateNode),
  };
  if (hashNode) {
    return {
      ...rootOfTrust,
      verifiedBootHashBase64: asOctetString(
        hashNode,
        'verifiedBootHash',
      ).toString('base64'),
    };
  }
  return rootOfTrust;
};

const decodeIntegerSet = (node: Asn1Node, label: string): number[] => {
  expectUniversal(node, UNIVERSAL_SET, label);
  return node.children.map((child) => asInteger(child, label));
};

const decodeUtf8OctetString = (node: Asn1Node, label: string): string =>
  asOctetString(node, label).toString('utf8');

const formatOsVersion = (raw: number): string => {
  const major = Math.floor(raw / 10000);
  const minor = Math.floor((raw % 10000) / 100);
  const patch = raw % 100;
  return `${major}.${minor}.${patch}`;
};

const formatOsPatchLevel = (raw: number): string | undefined => {
  // Keymaster encodes the patch level as YYYYMM; KeyMint sometimes uses
  // YYYYMMDD for bootPatchLevel. Only the YYYYMM form is expected here.
  const year = Math.floor(raw / 100);
  const month = raw % 100;
  if (year < 2008 || year > 2200 || month < 1 || month > 12) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-01`;
};

/**
 * AuthorizationList ::= SEQUENCE { ... } — every member is an OPTIONAL
 * context-specific EXPLICIT tag whose number is the KeyMint tag id.
 */
const decodeAuthorizationList = (
  node: Asn1Node,
  label: string,
): AuthorizationList => {
  expectUniversal(node, UNIVERSAL_SEQUENCE, label);
  const list: AuthorizationList = { unknownTags: [] };
  const seen = new Set<number>();

  for (const entry of node.children) {
    if (entry.tagClass !== TAG_CLASS_CONTEXT) {
      throw new KeyAttestationError(
        `${label} contains a non-context-specific member (tag ${entry.tagNumber})`,
      );
    }
    if (seen.has(entry.tagNumber)) {
      throw new KeyAttestationError(
        `${label} repeats tag ${entry.tagNumber}; DER SETs/SEQUENCEs must not duplicate members`,
      );
    }
    seen.add(entry.tagNumber);

    switch (entry.tagNumber) {
      case 1:
        list.purposes = decodeIntegerSet(explicitChild(entry, 'purpose'), 'purpose');
        break;
      case 2:
        list.algorithm = asInteger(explicitChild(entry, 'algorithm'), 'algorithm');
        break;
      case 3:
        list.keySize = asInteger(explicitChild(entry, 'keySize'), 'keySize');
        break;
      case 5:
        list.digests = decodeIntegerSet(explicitChild(entry, 'digest'), 'digest');
        break;
      case 10:
        list.ecCurve = asInteger(explicitChild(entry, 'ecCurve'), 'ecCurve');
        break;
      case 303:
        expectUniversal(
          explicitChild(entry, 'rollbackResistance'),
          UNIVERSAL_NULL,
          'rollbackResistance',
        );
        list.rollbackResistance = true;
        break;
      case 305:
        expectUniversal(
          explicitChild(entry, 'earlyBootOnly'),
          UNIVERSAL_NULL,
          'earlyBootOnly',
        );
        list.earlyBootOnly = true;
        break;
      case 503:
        expectUniversal(
          explicitChild(entry, 'noAuthRequired'),
          UNIVERSAL_NULL,
          'noAuthRequired',
        );
        list.noAuthRequired = true;
        break;
      case 509:
        expectUniversal(
          explicitChild(entry, 'unlockedDeviceRequired'),
          UNIVERSAL_NULL,
          'unlockedDeviceRequired',
        );
        list.unlockedDeviceRequired = true;
        break;
      case 701:
        list.creationDateTimeMs = asInteger(
          explicitChild(entry, 'creationDateTime'),
          'creationDateTime',
        );
        break;
      case 702:
        list.origin = asInteger(explicitChild(entry, 'origin'), 'origin');
        break;
      case 704:
        list.rootOfTrust = decodeRootOfTrust(explicitChild(entry, 'rootOfTrust'));
        break;
      case 705: {
        const raw = asInteger(explicitChild(entry, 'osVersion'), 'osVersion');
        list.osVersion = raw;
        list.osVersionText = formatOsVersion(raw);
        break;
      }
      case 706: {
        const raw = asInteger(
          explicitChild(entry, 'osPatchLevel'),
          'osPatchLevel',
        );
        list.osPatchLevel = raw;
        const date = formatOsPatchLevel(raw);
        if (date) list.osPatchLevelDate = date;
        break;
      }
      case 710:
        list.attestationIdBrand = decodeUtf8OctetString(
          explicitChild(entry, 'attestationIdBrand'),
          'attestationIdBrand',
        );
        break;
      case 711:
        list.attestationIdDevice = decodeUtf8OctetString(
          explicitChild(entry, 'attestationIdDevice'),
          'attestationIdDevice',
        );
        break;
      case 712:
        list.attestationIdProduct = decodeUtf8OctetString(
          explicitChild(entry, 'attestationIdProduct'),
          'attestationIdProduct',
        );
        break;
      case 716:
        list.attestationIdManufacturer = decodeUtf8OctetString(
          explicitChild(entry, 'attestationIdManufacturer'),
          'attestationIdManufacturer',
        );
        break;
      case 717:
        list.attestationIdModel = decodeUtf8OctetString(
          explicitChild(entry, 'attestationIdModel'),
          'attestationIdModel',
        );
        break;
      case 718:
        list.vendorPatchLevel = asInteger(
          explicitChild(entry, 'vendorPatchLevel'),
          'vendorPatchLevel',
        );
        break;
      case 719:
        list.bootPatchLevel = asInteger(
          explicitChild(entry, 'bootPatchLevel'),
          'bootPatchLevel',
        );
        break;
      case 720:
        expectUniversal(
          explicitChild(entry, 'deviceUniqueAttestation'),
          UNIVERSAL_NULL,
          'deviceUniqueAttestation',
        );
        list.deviceUniqueAttestation = true;
        break;
      default:
        // Unmodelled tags (attestationApplicationId, IMEI/MEID, moduleHash,
        // date-time windows, ...) are still structurally validated by the
        // reader; record the tag so new KeyMint fields surface in diagnostics.
        list.unknownTags.push(entry.tagNumber);
        break;
    }
  }

  return list;
};

/**
 * KeyDescription ::= SEQUENCE {
 *   attestationVersion        INTEGER,
 *   attestationSecurityLevel  SecurityLevel,
 *   keymasterVersion          INTEGER,
 *   keymasterSecurityLevel    SecurityLevel,
 *   attestationChallenge      OCTET_STRING,
 *   uniqueId                  OCTET_STRING,
 *   softwareEnforced          AuthorizationList,
 *   hardwareEnforced          AuthorizationList
 * }
 */
export const parseKeyDescription = (der: Buffer): KeyDescription => {
  let root: Asn1Node;
  try {
    root = decodeDer(der);
  } catch (error) {
    throw new KeyAttestationError(
      `Key Description is not valid DER: ${
        error instanceof Asn1Error ? error.message : String(error)
      }`,
    );
  }
  expectUniversal(root, UNIVERSAL_SEQUENCE, 'KeyDescription');
  const [
    versionNode,
    attestationLevelNode,
    keymasterVersionNode,
    keymasterLevelNode,
    challengeNode,
    uniqueIdNode,
    softwareNode,
    hardwareNode,
    ...rest
  ] = root.children;

  if (
    !versionNode ||
    !attestationLevelNode ||
    !keymasterVersionNode ||
    !keymasterLevelNode ||
    !challengeNode ||
    !uniqueIdNode ||
    !softwareNode ||
    !hardwareNode
  ) {
    throw new KeyAttestationError(
      `KeyDescription must have 8 fields, found ${root.children.length}`,
    );
  }
  if (rest.length > 0) {
    throw new KeyAttestationError('KeyDescription has unexpected extra fields');
  }
  expectUniversal(versionNode, UNIVERSAL_INTEGER, 'attestationVersion');
  expectUniversal(challengeNode, UNIVERSAL_OCTET_STRING, 'attestationChallenge');

  return {
    attestationVersion: asInteger(versionNode, 'attestationVersion'),
    attestationSecurityLevel: decodeSecurityLevel(
      attestationLevelNode,
      'attestationSecurityLevel',
    ),
    keymasterVersion: asInteger(keymasterVersionNode, 'keymasterVersion'),
    keymasterSecurityLevel: decodeSecurityLevel(
      keymasterLevelNode,
      'keymasterSecurityLevel',
    ),
    attestationChallenge: asOctetString(challengeNode, 'attestationChallenge'),
    uniqueId: asOctetString(uniqueIdNode, 'uniqueId'),
    softwareEnforced: decodeAuthorizationList(softwareNode, 'softwareEnforced'),
    hardwareEnforced: decodeAuthorizationList(hardwareNode, 'hardwareEnforced'),
  };
};

// ---------------------------------------------------------------------------
// Certificate plumbing
// ---------------------------------------------------------------------------

/**
 * Pulls a raw extension value out of a certificate. `X509Certificate` exposes
 * only a handful of well-known extensions, so the TBSCertificate is walked
 * directly:
 *   TBSCertificate ::= SEQUENCE { [0] version, serialNumber, signature,
 *     issuer, validity, subject, subjectPublicKeyInfo, [1] issuerUniqueID,
 *     [2] subjectUniqueID, [3] extensions }
 */
export const findCertificateExtension = (
  certificateDer: Buffer,
  oid: string,
): Buffer | undefined => {
  const certificate = decodeDer(certificateDer);
  expectUniversal(certificate, UNIVERSAL_SEQUENCE, 'Certificate');
  const tbs = certificate.children[0];
  if (!tbs) throw new KeyAttestationError('Certificate has no TBSCertificate');
  expectUniversal(tbs, UNIVERSAL_SEQUENCE, 'TBSCertificate');

  const extensionsTag = tbs.children.find(
    (child) => child.tagClass === TAG_CLASS_CONTEXT && child.tagNumber === 3,
  );
  if (!extensionsTag) return undefined;
  const extensions = explicitChild(extensionsTag, 'extensions');
  expectUniversal(extensions, UNIVERSAL_SEQUENCE, 'Extensions');

  for (const extension of extensions.children) {
    expectUniversal(extension, UNIVERSAL_SEQUENCE, 'Extension');
    const [oidNode, second, third] = extension.children;
    if (!oidNode) continue;
    if (asOid(oidNode, 'extnID') !== oid) continue;
    const valueNode =
      third ?? (second && isUniversal(second, UNIVERSAL_OCTET_STRING) ? second : undefined);
    if (!valueNode) {
      throw new KeyAttestationError(`Extension ${oid} has no extnValue`);
    }
    return asOctetString(valueNode, 'extnValue');
  }
  return undefined;
};

export const certificateSha256 = (der: Buffer): string =>
  createHash('sha256').update(der).digest('hex');

const normalizeSerial = (serialNumber: string): string =>
  serialNumber.replace(/^0+/u, '').toLowerCase() || '0';

export interface RevocationStatusProvider {
  isRevoked(serialNumberHex: string): Promise<boolean>;
}

export type TrustedRoot = {
  certificate: X509Certificate;
  der: Buffer;
  sha256: string;
  subject: string;
};

/** Parses a PEM bundle of Google Hardware Attestation Roots. */
export const parseTrustedRootsPem = (pem: string): TrustedRoot[] => {
  const blocks = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu,
  );
  if (!blocks || blocks.length === 0) {
    throw new KeyAttestationError(
      'Trusted attestation root bundle contains no PEM certificates',
    );
  }
  return blocks.map((block) => {
    const certificate = new X509Certificate(block);
    const der = Buffer.from(certificate.raw);
    return {
      certificate,
      der,
      sha256: certificateSha256(der),
      subject: certificate.subject,
    };
  });
};

export type KeyAttestationPolicy = {
  /** Reject a chain that does not terminate in a pinned Google root. */
  requireTrustedRoot: boolean;
  /** Reject TEE-only keys (StrongBox mandatory). */
  requireStrongBox: boolean;
  /** Accept `attestationSecurityLevel = SOFTWARE`. Never enable in production. */
  allowSoftwareSecurityLevel: boolean;
};

export type KeyAttestationVerification = {
  keyDescription: KeyDescription;
  chainLength: number;
  /** Chain terminates in one of the pinned Google roots. */
  rootTrusted: boolean;
  rootSubject: string;
  leafSerialHex: string;
  revokedSerials: string[];
  securityLevel: AttestationSecurityLevel;
  strongBox: boolean;
  /** StrongBox was not available and the TEE-backed key was accepted instead. */
  teeFallback: boolean;
  challengeMatches: boolean;
  rootOfTrust?: RootOfTrust;
  verifiedBootState?: VerifiedBootState;
  deviceLocked?: boolean;
  osVersion?: number;
  osVersionText?: string;
  osPatchLevel?: number;
  osPatchLevelDate?: string;
  attestedModel?: string;
  attestedManufacturer?: string;
  attestedBrand?: string;
  /** Non-fatal observations (leaf validity, missing revocation feed, ...). */
  warnings: string[];
};

const bytesEqual = (a: Buffer, b: Buffer): boolean =>
  a.length === b.length && timingSafeEqual(a, b);

/**
 * Verifies an Android Key Attestation chain end to end:
 *  1. every certificate's signature is checked against its issuer's public key;
 *  2. issuer/subject linkage and CA validity windows are checked;
 *  3. the terminal certificate must be a pinned Google Hardware Attestation
 *     Root (self-signed roots presented by the device are NOT trusted on their
 *     own);
 *  4. all serials are checked against Google's revocation status feed;
 *  5. the leaf's Key Description is decoded strictly and the attestation
 *     challenge is compared byte-for-byte with the expected value.
 *
 * Anything that undermines these guarantees throws; softer observations are
 * returned in `warnings`.
 */
export const verifyAndroidKeyAttestationChain = async (input: {
  certificateChainBase64: string[];
  expectedChallenge: Buffer;
  trustedRoots: TrustedRoot[];
  policy: KeyAttestationPolicy;
  revocationProvider?: RevocationStatusProvider;
  nowMs?: number;
}): Promise<KeyAttestationVerification> => {
  const warnings: string[] = [];
  const nowMs = input.nowMs ?? Date.now();

  if (input.certificateChainBase64.length === 0) {
    throw new KeyAttestationError('Key attestation certificate chain is empty');
  }

  const ders = input.certificateChainBase64.map((base64, index) => {
    const der = Buffer.from(base64, 'base64');
    if (der.length === 0) {
      throw new KeyAttestationError(
        `Certificate #${index} in the chain is not valid base64 DER`,
      );
    }
    return der;
  });

  const certificates = ders.map((der, index) => {
    try {
      return new X509Certificate(der);
    } catch (error) {
      throw new KeyAttestationError(
        `Certificate #${index} could not be parsed: ${String(error)}`,
      );
    }
  });

  const leaf = certificates[0]!;
  const leafDer = ders[0]!;

  // 1 + 2. Signature of every certificate against its issuer.
  for (let index = 0; index < certificates.length - 1; index += 1) {
    const subject = certificates[index]!;
    const issuer = certificates[index + 1]!;
    if (!subject.checkIssued(issuer)) {
      throw new KeyAttestationError(
        `Certificate #${index} is not issued by certificate #${index + 1}`,
      );
    }
    if (!subject.verify(issuer.publicKey)) {
      throw new KeyAttestationError(
        `Signature of certificate #${index} does not verify against its issuer`,
      );
    }
  }

  certificates.forEach((certificate, index) => {
    const notBefore = Date.parse(certificate.validFrom);
    const notAfter = Date.parse(certificate.validTo);
    const expired = Number.isFinite(notAfter) && notAfter < nowMs;
    const premature = Number.isFinite(notBefore) && notBefore > nowMs;
    if (!expired && !premature) return;
    const description = `certificate #${index} (${certificate.subject}) validity ${certificate.validFrom} .. ${certificate.validTo}`;
    if (index === 0) {
      // Attestation leaf validity mirrors the generated key's validity, which
      // is frequently degenerate. Do not fail the whole chain on it.
      warnings.push(`Attestation leaf is outside its validity window: ${description}`);
      return;
    }
    throw new KeyAttestationError(`CA ${description} is not currently valid`);
  });

  // 3. Root pinning.
  const terminal = certificates[certificates.length - 1]!;
  const terminalDer = ders[ders.length - 1]!;
  const terminalSha256 = certificateSha256(terminalDer);
  let rootTrusted = input.trustedRoots.some(
    (root) => root.sha256 === terminalSha256,
  );
  if (!rootTrusted) {
    // The device may omit the root; accept a pinned root that signed the
    // terminal certificate we did receive.
    rootTrusted = input.trustedRoots.some((root) => {
      try {
        return (
          terminal.checkIssued(root.certificate) &&
          terminal.verify(root.certificate.publicKey)
        );
      } catch {
        return false;
      }
    });
  }
  if (!rootTrusted) {
    if (input.trustedRoots.length === 0) {
      const message =
        'No Google Hardware Attestation Root is pinned; configure ATTESTATION_ANDROID_ATTESTATION_ROOTS_PEM/_PATH';
      if (input.policy.requireTrustedRoot) throw new KeyAttestationError(message);
      warnings.push(message);
    } else {
      const message = `Chain does not terminate in a pinned Google Hardware Attestation Root (terminal subject: ${terminal.subject})`;
      if (input.policy.requireTrustedRoot) throw new KeyAttestationError(message);
      warnings.push(message);
    }
  }

  // 4. Revocation of every serial in the chain.
  const revokedSerials: string[] = [];
  if (input.revocationProvider) {
    for (const certificate of certificates) {
      const serial = normalizeSerial(certificate.serialNumber);
      try {
        if (await input.revocationProvider.isRevoked(serial)) {
          revokedSerials.push(serial);
        }
      } catch (error) {
        warnings.push(
          `Revocation status for serial ${serial} is unavailable: ${String(error)}`,
        );
        break;
      }
    }
  } else {
    warnings.push('Revocation checking is disabled');
  }
  if (revokedSerials.length > 0) {
    throw new KeyAttestationError(
      `Certificate serial(s) ${revokedSerials.join(', ')} are revoked by Google`,
    );
  }

  // 5. Key Description.
  const extensionValue = findCertificateExtension(
    leafDer,
    ANDROID_KEY_ATTESTATION_OID,
  );
  if (!extensionValue) {
    throw new KeyAttestationError(
      `Attestation leaf has no Key Description extension (${ANDROID_KEY_ATTESTATION_OID})`,
    );
  }
  const keyDescription = parseKeyDescription(extensionValue);

  const challengeMatches = bytesEqual(
    keyDescription.attestationChallenge,
    input.expectedChallenge,
  );
  if (!challengeMatches) {
    throw new KeyAttestationError(
      'attestationChallenge does not match sha256(nonce || payloadHash)',
    );
  }

  const securityLevel = keyDescription.attestationSecurityLevel;
  const strongBox = securityLevel === 'STRONG_BOX';
  const teeFallback = securityLevel === 'TRUSTED_ENVIRONMENT';
  if (securityLevel === 'SOFTWARE' && !input.policy.allowSoftwareSecurityLevel) {
    throw new KeyAttestationError(
      'attestationSecurityLevel is SOFTWARE; the key is not hardware-backed',
    );
  }
  if (input.policy.requireStrongBox && !strongBox) {
    throw new KeyAttestationError(
      `StrongBox is required but attestationSecurityLevel is ${securityLevel}`,
    );
  }
  if (teeFallback) {
    warnings.push('StrongBox unavailable; accepted TEE-backed attestation');
  }
  if (keyDescription.keymasterSecurityLevel === 'SOFTWARE') {
    warnings.push('keymasterSecurityLevel is SOFTWARE');
  }

  // rootOfTrust lives in hardwareEnforced on any hardware-backed key; the
  // softwareEnforced copy is only a fallback for SOFTWARE-level attestations.
  const rootOfTrust =
    keyDescription.hardwareEnforced.rootOfTrust ??
    keyDescription.softwareEnforced.rootOfTrust;
  if (!rootOfTrust && securityLevel !== 'SOFTWARE') {
    throw new KeyAttestationError(
      'Key Description has no rootOfTrust for a hardware-backed key',
    );
  }

  const osVersion =
    keyDescription.hardwareEnforced.osVersion ??
    keyDescription.softwareEnforced.osVersion;
  const osVersionText =
    keyDescription.hardwareEnforced.osVersionText ??
    keyDescription.softwareEnforced.osVersionText;
  const osPatchLevel =
    keyDescription.hardwareEnforced.osPatchLevel ??
    keyDescription.softwareEnforced.osPatchLevel;
  const osPatchLevelDate =
    keyDescription.hardwareEnforced.osPatchLevelDate ??
    keyDescription.softwareEnforced.osPatchLevelDate;
  if (osVersion === undefined) {
    warnings.push('Key Description does not carry osVersion');
  }
  if (osPatchLevel === undefined) {
    warnings.push('Key Description does not carry osPatchLevel');
  }

  const attested = keyDescription.hardwareEnforced;

  return {
    keyDescription,
    chainLength: certificates.length,
    rootTrusted,
    rootSubject: terminal.subject,
    leafSerialHex: normalizeSerial(leaf.serialNumber),
    revokedSerials,
    securityLevel,
    strongBox,
    teeFallback,
    challengeMatches,
    warnings,
    ...(rootOfTrust ? { rootOfTrust } : {}),
    ...(rootOfTrust ? { verifiedBootState: rootOfTrust.verifiedBootState } : {}),
    ...(rootOfTrust ? { deviceLocked: rootOfTrust.deviceLocked } : {}),
    ...(osVersion !== undefined ? { osVersion } : {}),
    ...(osVersionText !== undefined ? { osVersionText } : {}),
    ...(osPatchLevel !== undefined ? { osPatchLevel } : {}),
    ...(osPatchLevelDate !== undefined ? { osPatchLevelDate } : {}),
    ...(attested.attestationIdModel
      ? { attestedModel: attested.attestationIdModel }
      : {}),
    ...(attested.attestationIdManufacturer
      ? { attestedManufacturer: attested.attestationIdManufacturer }
      : {}),
    ...(attested.attestationIdBrand
      ? { attestedBrand: attested.attestationIdBrand }
      : {}),
  };
};
