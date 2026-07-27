import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { createLocalJWKSet, jwtVerify } from 'jose';
import Config from '../../../config/attestation.config';
import { computePayloadHash } from './crypto';
import type { JitClaims, Signer } from './jitSigner';
import type { TrustTier } from '@attestation/shared/wire';

export type { JitClaims, RotationStatus, Signer } from './jitSigner';
export {
  GcpKmsEd25519Signer,
  LocalEd25519Signer,
  PersistentEd25519Signer,
  resolveSigner,
} from './jitSigner';

type JcsModule = {
  canonicalize?: (value: unknown) => string;
  default?: (value: unknown) => string;
};

const canonicalizePayload = async (value: unknown): Promise<string> => {
  const module = (await import('json-canonicalize')) as unknown as JcsModule;
  const canonicalize = module.canonicalize ?? module.default;
  if (!canonicalize) {
    throw new Error('json-canonicalize did not expose a canonicalizer');
  }
  return canonicalize(value);
};

const ttlForTier = (tier: Exclude<TrustTier, 'BLOCKED'>): number =>
  Config.jit.ttlByTierSeconds[tier];

export const mintJitToken = async (
  signer: Signer,
  input: {
    userId: string;
    tier: Exclude<TrustTier, 'BLOCKED'>;
    payloadHash: string;
    deviceId: string;
  },
): Promise<{ token: string; expiresAt: number }> =>
  signer.signJwt(
    {
      sub: input.userId,
      aud: Config.jit.apiAudience,
      tier: input.tier,
      actionHash: input.payloadHash,
      deviceId: input.deviceId,
      nonceConsumed: true,
    } satisfies JitClaims,
    ttlForTier(input.tier),
  );

/**
 * Publishes every key verifiers should accept: the active signing key plus any
 * retired keys still inside the rotation overlap window.
 */
export function createJwksRouter(signer: Signer): Router {
  const router = express.Router();
  router.get('/.well-known/jwks.json', async (_req, res, next) => {
    try {
      const keys = await signer.publicJwks();
      // Short cache: long enough to matter under load, short enough that a
      // rotation propagates well inside the overlap window.
      res.setHeader('cache-control', 'public, max-age=300');
      res.json({ keys });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

/**
 * Verifies a JIT token against the published JWKS — so a token signed by a key
 * retired during the overlap window still verifies — and re-binds it to the
 * incoming request body.
 */
export const requireJitToken =
  (signer: Signer, requiredTier: Exclude<TrustTier, 'BLOCKED'>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authorization = req.header('authorization') ?? '';
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    if (!token) {
      res.status(401).json({ error: 'missing JIT token' });
      return;
    }

    try {
      const jwks = createLocalJWKSet({ keys: await signer.publicJwks() });
      const { payload } = await jwtVerify(token, jwks, {
        audience: Config.jit.apiAudience,
        algorithms: ['EdDSA'],
      });
      const tier = payload.tier as TrustTier | undefined;
      const ranks: Record<Exclude<TrustTier, 'BLOCKED'>, number> = {
        RESTRICTED: 1,
        STANDARD: 2,
        ELEVATED: 3,
        HIGHEST: 4,
      };
      if (!tier || tier === 'BLOCKED' || ranks[tier] < ranks[requiredTier]) {
        res.status(403).json({ error: 'insufficient JIT token tier' });
        return;
      }

      const canonical = await canonicalizePayload(req.body);
      const incomingHash = computePayloadHash(canonical);
      if (incomingHash !== payload.actionHash) {
        res.status(403).json({ error: 'JIT token action hash mismatch' });
        return;
      }

      next();
    } catch {
      res.status(401).json({ error: 'invalid JIT token' });
    }
  };
