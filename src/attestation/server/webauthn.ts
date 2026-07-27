import type { Request, Response, Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import Config from '../../../config/attestation.config';
import { computeAttestationRequestHash } from './crypto';
import { getRequestUserId } from './nonceRoute';

type WebAuthnChallengeRecord = {
  challengeId: string;
  challenge: string;
  userId: string;
  payloadHash: string;
  nonce: string;
  mode: 'registration' | 'authentication';
  expiresAtMs: number;
};

export type WebAuthnCredential = {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  aaguid?: string;
  transports?: string[];
  crossPlatform: boolean;
};

export interface WebAuthnCredentialStore {
  getForUser(userId: string): Promise<WebAuthnCredential | undefined>;
  saveForUser(userId: string, credential: WebAuthnCredential): Promise<void>;
}

export interface MdsTrustProvider {
  isTrustedAaguid(aaguid?: string): Promise<boolean>;
}

export class InMemoryWebAuthnCredentialStore
  implements WebAuthnCredentialStore
{
  private readonly credentials = new Map<string, WebAuthnCredential>();

  async getForUser(userId: string): Promise<WebAuthnCredential | undefined> {
    return this.credentials.get(userId);
  }

  async saveForUser(
    userId: string,
    credential: WebAuthnCredential,
  ): Promise<void> {
    this.credentials.set(userId, credential);
  }
}

export class StaticMdsTrustProvider implements MdsTrustProvider {
  constructor(private readonly trustedAaguids = new Set<string>()) {}

  async isTrustedAaguid(aaguid?: string): Promise<boolean> {
    return Boolean(aaguid && this.trustedAaguids.has(aaguid));
  }
}

export class FidoMds3TrustProvider implements MdsTrustProvider {
  private cache?: { loadedAtMs: number; trustedAaguids: Set<string> };

  constructor(private readonly feedUrl = Config.webauthn.mds3Url) {}

  async isTrustedAaguid(aaguid?: string): Promise<boolean> {
    if (!aaguid) return false;
    const now = Date.now();
    if (!this.cache || now - this.cache.loadedAtMs > 24 * 60 * 60 * 1000) {
      const response = await fetch(this.feedUrl);
      const jwt = await response.text();
      const payload = decodeJwt(jwt) as {
        entries?: Array<{
          aaguid?: string;
          statusReports?: Array<{ status?: string }>;
        }>;
      };
      const trustedAaguids = new Set(
        (payload.entries ?? [])
          .filter((entry) =>
            (entry.statusReports ?? []).every(
              (report) => report.status !== 'REVOKED',
            ),
          )
          .map((entry) => entry.aaguid)
          .filter((value): value is string => Boolean(value)),
      );
      this.cache = { loadedAtMs: now, trustedAaguids };
    }
    return this.cache.trustedAaguids.has(aaguid);
  }
}

export class InMemoryWebAuthnChallengeStore {
  private readonly challenges = new Map<string, WebAuthnChallengeRecord>();

  put(record: WebAuthnChallengeRecord): void {
    this.challenges.set(record.challengeId, record);
  }

  consume(challengeId: string): WebAuthnChallengeRecord | undefined {
    const record = this.challenges.get(challengeId);
    this.challenges.delete(challengeId);
    if (!record || record.expiresAtMs < Date.now()) return undefined;
    return record;
  }
}

const randomChallengeId = (): string => randomUUID();

export function createWebAuthnRouter(deps: {
  credentialStore: WebAuthnCredentialStore;
  challengeStore?: InMemoryWebAuthnChallengeStore;
  mdsTrustProvider: MdsTrustProvider;
  onVerified?: (
    userId: string,
    result: {
      used: boolean;
      crossPlatform: boolean;
      aaguidTrusted: boolean;
      verifiedAtMs: number;
    },
  ) => Promise<void> | void;
}): Router {
  const router = express.Router();
  const challenges = deps.challengeStore ?? new InMemoryWebAuthnChallengeStore();

  router.post('/attest/webauthn/challenge', async (req: Request, res: Response) => {
    const userId = getRequestUserId(req);
    const { payloadHash, nonce } = req.body as {
      payloadHash?: string;
      nonce?: string;
    };
    if (!payloadHash || !nonce) {
      res.status(400).json({ error: 'payloadHash and nonce are required' });
      return;
    }

    const existing = await deps.credentialStore.getForUser(userId);
    const challenge = computeAttestationRequestHash(nonce, payloadHash);
    const challengeId = randomChallengeId();
    const mode = existing ? 'authentication' : 'registration';

    challenges.put({
      challengeId,
      challenge,
      userId,
      payloadHash,
      nonce,
      mode,
      expiresAtMs: Date.now() + 5 * 60 * 1000,
    });

    if (!existing) {
      const options = await generateRegistrationOptions({
        rpID: Config.webauthn.rpId,
        rpName: Config.webauthn.rpName,
        userID: Buffer.from(userId),
        userName: userId,
        attestationType: 'direct',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
          authenticatorAttachment: 'cross-platform',
        },
        challenge,
      });
      res.json({ challengeId, mode, options });
      return;
    }

    const options = await generateAuthenticationOptions({
      rpID: Config.webauthn.rpId,
      userVerification: 'required',
      allowCredentials: [
        {
          id: existing.credentialId,
          transports: existing.transports as never,
        },
      ],
      challenge,
    });
    res.json({ challengeId, mode, options });
  });

  router.post('/attest/webauthn/verify', async (req: Request, res: Response) => {
    const { challengeId, response } = req.body as {
      challengeId?: string;
      response?: unknown;
    };
    if (!challengeId || !response) {
      res.status(400).json({ error: 'challengeId and response are required' });
      return;
    }

    const record = challenges.consume(challengeId);
    if (!record) {
      res.status(400).json({ error: 'challenge expired or already used' });
      return;
    }

    if (record.mode === 'registration') {
      const verification = await verifyRegistrationResponse({
        response: response as never,
        expectedChallenge: record.challenge,
        expectedOrigin: Config.webauthn.origin,
        expectedRPID: Config.webauthn.rpId,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) {
        res.status(403).json({ error: 'registration verification failed' });
        return;
      }
      const credential = verification.registrationInfo.credential;
      const aaguid = verification.registrationInfo.aaguid;
      const transports = credential.transports ?? [];
      const crossPlatform = transports.some((transport) =>
        ['usb', 'nfc', 'ble'].includes(String(transport)),
      );
      const aaguidTrusted = await deps.mdsTrustProvider.isTrustedAaguid(aaguid);
      await deps.credentialStore.saveForUser(record.userId, {
        credentialId: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        ...(aaguid ? { aaguid } : {}),
        ...(transports.length > 0 ? { transports } : {}),
        crossPlatform,
      });
      const result = {
        used: true,
        crossPlatform,
        aaguidTrusted,
        verifiedAtMs: Date.now(),
      };
      await deps.onVerified?.(record.userId, result);
      res.json(result);
      return;
    }

    const stored = await deps.credentialStore.getForUser(record.userId);
    if (!stored) {
      res.status(404).json({ error: 'credential not registered' });
      return;
    }

    const verification = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge: record.challenge,
      expectedOrigin: Config.webauthn.origin,
      expectedRPID: Config.webauthn.rpId,
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        // Copy into a plain ArrayBuffer-backed view: the store may hand back a
        // Buffer (Postgres bytea) whose backing buffer type is wider.
        publicKey: new Uint8Array(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports as never,
      },
    });

    if (!verification.verified) {
      res.status(403).json({ error: 'authentication verification failed' });
      return;
    }

    await deps.credentialStore.saveForUser(record.userId, {
      ...stored,
      counter: verification.authenticationInfo.newCounter,
    });
    const result = {
      used: true,
      crossPlatform: stored.crossPlatform,
      aaguidTrusted: await deps.mdsTrustProvider.isTrustedAaguid(stored.aaguid),
      verifiedAtMs: Date.now(),
    };
    await deps.onVerified?.(record.userId, result);
    res.json(result);
  });

  return router;
}
