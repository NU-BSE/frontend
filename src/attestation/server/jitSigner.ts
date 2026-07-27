import { createPrivateKey } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  type JWK,
  type KeyObject,
} from 'jose';
import Config from '../../../config/attestation.config';
import { loadGoogleServiceAccount } from './playIntegrity';

const ALG = 'EdDSA' as const;
const CLOUD_KMS_SCOPE = 'https://www.googleapis.com/auth/cloudkms';
const DAY_MS = 24 * 60 * 60 * 1000;

export type JitClaims = {
  sub: string;
  aud: string;
  tier: 'RESTRICTED' | 'STANDARD' | 'ELEVATED' | 'HIGHEST';
  actionHash: string;
  deviceId: string;
  nonceConsumed: true;
};

export interface Signer {
  /** Stable key id published in JWKS and set in the JWT header. */
  readonly kid: string;
  readonly alg: 'EdDSA';
  signJwt(
    claims: JitClaims,
    ttlSeconds: number,
  ): Promise<{ token: string; expiresAt: number }>;
  /** The active signing key. */
  publicJwk(): Promise<JWK>;
  /**
   * Every key verifiers should accept: the active key plus the keys still
   * inside the rotation overlap window.
   */
  publicJwks(): Promise<JWK[]>;
}

export type RotationStatus = {
  activeKid: string;
  provider: string;
  rotationIntervalDays: number;
  rotationOverlapDays: number;
  activeKeyCreatedAt?: string;
  activeKeyAgeDays?: number;
  /** True when the active key is past its rotation interval. */
  rotationDue: boolean;
  publishedKids: string[];
};

const base64Url = (value: Buffer | string): string =>
  Buffer.from(value as never).toString('base64url');

const jwkFor = async (
  publicKey: KeyObject | CryptoKey,
  kid: string,
): Promise<JWK> => ({
  ...(await exportJWK(publicKey)),
  kid,
  alg: ALG,
  use: 'sig',
});

type RetiredPublicKey = { kid: string; publicKeyPem: string };

const parseRetiredPublicKeys = (raw?: string): RetiredPublicKey[] => {
  if (!raw) return [];
  // Accept raw JSON or base64 of it; secret managers mangle newlines either way.
  const candidates = [raw, Buffer.from(raw, 'base64').toString('utf8')];
  let parsed: unknown;
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    throw new Error(
      `Retired JIT public keys are neither JSON nor base64-encoded JSON: ${String(lastError)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Retired JIT public keys must be a JSON array');
  }
  return parsed.map((entry, index) => {
    const item = entry as Partial<RetiredPublicKey>;
    if (!item.kid || !item.publicKeyPem) {
      throw new Error(
        `Retired JIT key #${index} must have "kid" and "publicKeyPem"`,
      );
    }
    return {
      kid: item.kid,
      publicKeyPem: item.publicKeyPem.replace(/\\n/gu, '\n'),
    };
  });
};

const retiredJwks = async (raw?: string): Promise<JWK[]> => {
  const retired = parseRetiredPublicKeys(raw);
  return Promise.all(
    retired.map(async (entry) =>
      jwkFor(await importSPKI(entry.publicKeyPem, ALG), entry.kid),
    ),
  );
};

const ageDays = (isoDate?: string): number | undefined => {
  if (!isoDate) return undefined;
  const created = Date.parse(isoDate);
  if (!Number.isFinite(created)) return undefined;
  return Math.floor((Date.now() - created) / DAY_MS);
};

// ---------------------------------------------------------------------------
// Development-only signer
// ---------------------------------------------------------------------------

/**
 * Ephemeral Ed25519 key generated at boot. Every restart invalidates every
 * previously issued token, so this is for local development only — production
 * must use `env` (persistent key material) or `gcpKms`.
 */
export class LocalEd25519Signer implements Signer {
  readonly alg = ALG;

  private constructor(
    readonly kid: string,
    private readonly privateKey: CryptoKey,
    private readonly publicKey: CryptoKey,
  ) {}

  static async create(kid = 'local-dev-ed25519'): Promise<LocalEd25519Signer> {
    const { privateKey, publicKey } = await generateKeyPair(ALG, {
      crv: 'Ed25519',
      extractable: true,
    });
    return new LocalEd25519Signer(kid, privateKey, publicKey);
  }

  async signJwt(
    claims: JitClaims,
    ttlSeconds: number,
  ): Promise<{ token: string; expiresAt: number }> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;
    const token = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: this.alg, kid: this.kid })
      .setSubject(claims.sub)
      .setAudience(claims.aud)
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .setJti(crypto.randomUUID())
      .sign(this.privateKey);
    return { token, expiresAt: expiresAt * 1000 };
  }

  async publicJwk(): Promise<JWK> {
    return jwkFor(this.publicKey, this.kid);
  }

  async publicJwks(): Promise<JWK[]> {
    return [await this.publicJwk()];
  }
}

// ---------------------------------------------------------------------------
// Persistent key material supplied out-of-band (Vault, sealed secret, ...)
// ---------------------------------------------------------------------------

/**
 * Signs with a persistent Ed25519 private key under a stable `kid`, so tokens
 * stay verifiable across restarts and deploys. Retired public keys are still
 * published in JWKS for the duration of the overlap window.
 */
export class PersistentEd25519Signer implements Signer {
  readonly alg = ALG;

  private constructor(
    readonly kid: string,
    private readonly privateKey: CryptoKey | KeyObject,
    private readonly publicJwkValue: JWK,
    private readonly retired: JWK[],
  ) {}

  static async create(input: {
    kid: string;
    privateKeyPem: string;
    retiredPublicKeysJson?: string;
  }): Promise<PersistentEd25519Signer> {
    const privateKey = await importPKCS8(input.privateKeyPem, ALG);
    // Derive the public JWK from the private key so the two can never drift.
    const publicKeyObject = createPrivateKey(input.privateKeyPem);
    const jwk = await exportJWK(publicKeyObject);
    delete jwk.d;
    return new PersistentEd25519Signer(
      input.kid,
      privateKey,
      { ...jwk, kid: input.kid, alg: ALG, use: 'sig' },
      await retiredJwks(input.retiredPublicKeysJson),
    );
  }

  async signJwt(
    claims: JitClaims,
    ttlSeconds: number,
  ): Promise<{ token: string; expiresAt: number }> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;
    const token = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: this.alg, kid: this.kid })
      .setSubject(claims.sub)
      .setAudience(claims.aud)
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .setJti(crypto.randomUUID())
      .sign(this.privateKey as CryptoKey);
    return { token, expiresAt: expiresAt * 1000 };
  }

  async publicJwk(): Promise<JWK> {
    return this.publicJwkValue;
  }

  async publicJwks(): Promise<JWK[]> {
    return [this.publicJwkValue, ...this.retired];
  }
}

// ---------------------------------------------------------------------------
// KMS / HSM
// ---------------------------------------------------------------------------

/**
 * Signs JIT tokens with an Ed25519 key that never leaves Cloud KMS (or Cloud
 * HSM, if the key ring's protection level is HSM). The JWS signing input is
 * built by hand because the private key is unavailable locally: KMS's
 * `asymmetricSign` receives the raw `header.payload` bytes — Ed25519 hashes
 * internally, so no client-side digest is involved.
 *
 * The `kid` is derived from the KMS key version resource name, which makes it
 * stable across restarts and unambiguous during a rotation.
 */
export class GcpKmsEd25519Signer implements Signer {
  readonly alg = ALG;

  private constructor(
    readonly kid: string,
    private readonly keyVersionName: string,
    private readonly auth: GoogleAuth,
    private readonly activeJwk: JWK,
    private readonly retired: JWK[],
  ) {}

  static kidFor(keyVersionName: string): string {
    // projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/3
    const parts = keyVersionName.split('/');
    const key = parts[parts.length - 3] ?? 'kms';
    const version = parts[parts.length - 1] ?? '0';
    return `${key}-v${version}`;
  }

  static async create(input: {
    keyVersionName: string;
    retiredKeyVersionNames?: string[];
    retiredPublicKeysJson?: string;
  }): Promise<GcpKmsEd25519Signer> {
    const credentials = loadGoogleServiceAccount();
    const auth = new GoogleAuth({
      scopes: [CLOUD_KMS_SCOPE],
      ...(credentials ? { credentials } : {}),
    });

    const activePem = await GcpKmsEd25519Signer.fetchPublicKeyPem(
      auth,
      input.keyVersionName,
    );
    const activeJwk = await jwkFor(
      await importSPKI(activePem, ALG),
      GcpKmsEd25519Signer.kidFor(input.keyVersionName),
    );

    const retiredFromKms = await Promise.all(
      (input.retiredKeyVersionNames ?? []).map(async (name) =>
        jwkFor(
          await importSPKI(
            await GcpKmsEd25519Signer.fetchPublicKeyPem(auth, name),
            ALG,
          ),
          GcpKmsEd25519Signer.kidFor(name),
        ),
      ),
    );

    return new GcpKmsEd25519Signer(
      GcpKmsEd25519Signer.kidFor(input.keyVersionName),
      input.keyVersionName,
      auth,
      activeJwk,
      [...retiredFromKms, ...(await retiredJwks(input.retiredPublicKeysJson))],
    );
  }

  private static async fetchPublicKeyPem(
    auth: GoogleAuth,
    keyVersionName: string,
  ): Promise<string> {
    const client = await auth.getClient();
    const response = await client.request<{ pem?: string; algorithm?: string }>({
      url: `https://cloudkms.googleapis.com/v1/${keyVersionName}/publicKey`,
      method: 'GET',
    });
    const pem = response.data.pem;
    if (!pem) {
      throw new Error(`Cloud KMS returned no public key for ${keyVersionName}`);
    }
    if (response.data.algorithm && !/ED25519/u.test(response.data.algorithm)) {
      throw new Error(
        `Cloud KMS key ${keyVersionName} has algorithm ${response.data.algorithm}; ED25519 is required`,
      );
    }
    return pem;
  }

  async signJwt(
    claims: JitClaims,
    ttlSeconds: number,
  ): Promise<{ token: string; expiresAt: number }> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;
    const header = base64Url(
      JSON.stringify({ alg: this.alg, kid: this.kid, typ: 'JWT' }),
    );
    const payload = base64Url(
      JSON.stringify({
        ...claims,
        iat: now,
        exp: expiresAt,
        jti: crypto.randomUUID(),
      }),
    );
    const signingInput = `${header}.${payload}`;

    const client = await this.auth.getClient();
    const response = await client.request<{ signature?: string }>({
      url: `https://cloudkms.googleapis.com/v1/${this.keyVersionName}:asymmetricSign`,
      method: 'POST',
      // Ed25519 signs the message itself; `data` carries the JWS signing input.
      data: { data: Buffer.from(signingInput, 'utf8').toString('base64') },
    });
    const signature = response.data.signature;
    if (!signature) {
      throw new Error('Cloud KMS asymmetricSign returned no signature');
    }
    return {
      token: `${signingInput}.${Buffer.from(signature, 'base64').toString('base64url')}`,
      expiresAt: expiresAt * 1000,
    };
  }

  async publicJwk(): Promise<JWK> {
    return this.activeJwk;
  }

  async publicJwks(): Promise<JWK[]> {
    return [this.activeJwk, ...this.retired];
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type ResolvedSigner = {
  signer: Signer;
  rotation: RotationStatus;
  notes: string[];
};

/**
 * Builds the signer configured by `ATTESTATION_JIT_SIGNER_PROVIDER`.
 *
 * Rotation regulation (see docs/jit-key-rotation.md): rotate every
 * `rotationIntervalDays` (90 by default) and keep the previous public key in
 * JWKS for `rotationOverlapDays` (14) so tokens minted before the switch stay
 * verifiable. `rotationDue` in the returned status is what the boot log and the
 * ops alert read.
 */
export const resolveSigner = async (): Promise<ResolvedSigner> => {
  const settings = Config.jit.signer;
  const notes: string[] = [];
  let signer: Signer;

  switch (settings.provider) {
    case 'gcpKms': {
      if (!settings.gcpKms.keyVersionName) {
        throw new Error(
          'ATTESTATION_JIT_GCP_KMS_KEY_VERSION is required when the JIT signer provider is gcpKms',
        );
      }
      signer = await GcpKmsEd25519Signer.create({
        keyVersionName: settings.gcpKms.keyVersionName,
        retiredKeyVersionNames: settings.gcpKms.retiredKeyVersionNames,
        ...(settings.retiredPublicKeysJson
          ? { retiredPublicKeysJson: settings.retiredPublicKeysJson }
          : {}),
      });
      notes.push(
        `JIT signer: Cloud KMS ${settings.gcpKms.keyVersionName} (kid ${signer.kid})`,
      );
      break;
    }
    case 'env': {
      if (!settings.activePrivateKeyPem) {
        throw new Error(
          'ATTESTATION_JIT_ACTIVE_PRIVATE_KEY_PEM is required when the JIT signer provider is env',
        );
      }
      signer = await PersistentEd25519Signer.create({
        kid: settings.activeKid,
        privateKeyPem: settings.activePrivateKeyPem,
        ...(settings.retiredPublicKeysJson
          ? { retiredPublicKeysJson: settings.retiredPublicKeysJson }
          : {}),
      });
      notes.push(`JIT signer: persistent Ed25519 key (kid ${signer.kid})`);
      break;
    }
    default: {
      if (Config.requireProductionDependencies) {
        throw new Error(
          'The local JIT signer generates an ephemeral key at boot and must not be used in production; set ATTESTATION_JIT_SIGNER_PROVIDER=gcpKms or env',
        );
      }
      signer = await LocalEd25519Signer.create(settings.activeKid);
      notes.push(
        'JIT signer: EPHEMERAL local Ed25519 key — tokens stop verifying after a restart (development only)',
      );
      break;
    }
  }

  const publishedKids = (await signer.publicJwks())
    .map((jwk) => jwk.kid)
    .filter((kid): kid is string => Boolean(kid));
  const activeAge = ageDays(settings.activeKeyCreatedAt);
  const rotationDue =
    activeAge !== undefined && activeAge >= settings.rotationIntervalDays;
  if (rotationDue) {
    notes.push(
      `JIT signing key ${signer.kid} is ${activeAge} days old and is past its ${settings.rotationIntervalDays}-day rotation interval`,
    );
  }

  return {
    signer,
    notes,
    rotation: {
      activeKid: signer.kid,
      provider: settings.provider,
      rotationIntervalDays: settings.rotationIntervalDays,
      rotationOverlapDays: settings.rotationOverlapDays,
      rotationDue,
      publishedKids,
      ...(settings.activeKeyCreatedAt
        ? { activeKeyCreatedAt: settings.activeKeyCreatedAt }
        : {}),
      ...(activeAge !== undefined ? { activeKeyAgeDays: activeAge } : {}),
    },
  };
};
