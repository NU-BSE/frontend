import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import Config from '../../../config/attestation.config';
import { randomNonce } from './crypto';
import type { LatencySignals, NonceRequest, NonceResponse } from '@attestation/shared/wire';

export type StoredNonce = {
  nonce: string;
  serverIssuedAt: number;
  clientTs: number;
  clientIp: string;
  userAgent: string;
  userId: string;
  expiresAt: number;
};

export interface NonceStore {
  put(record: StoredNonce): Promise<void>;
  get(nonce: string): Promise<StoredNonce | undefined>;
  consume(nonce: string, userId: string): Promise<StoredNonce | undefined>;
}

export class InMemoryNonceStore implements NonceStore {
  private readonly records = new Map<string, StoredNonce>();

  async put(record: StoredNonce): Promise<void> {
    this.records.set(record.nonce, record);
  }

  async get(nonce: string): Promise<StoredNonce | undefined> {
    const record = this.records.get(nonce);
    if (!record) return undefined;
    if (record.expiresAt < Date.now()) {
      this.records.delete(nonce);
      return undefined;
    }
    return record;
  }

  async consume(
    nonce: string,
    userId: string,
  ): Promise<StoredNonce | undefined> {
    // Read and delete without an intervening `await`: awaiting first yields the
    // microtask queue, which would let concurrent /attest/verify requests all
    // observe the nonce before any of them removed it.
    const record = this.records.get(nonce);
    this.records.delete(nonce);
    if (!record) return undefined;
    if (record.userId !== userId) return undefined;
    if (record.expiresAt < Date.now()) return undefined;
    return record;
  }
}

declare global {
  namespace Express {
    interface Request {
      attestationLatency?: LatencySignals;
      attestationNonceRecord?: StoredNonce;
      attestationUserId?: string;
    }
  }
}

export const getRequestUserId = (req: Request): string =>
  req.header('x-user-id') ?? req.attestationUserId ?? 'anonymous';

export const createNonceRouter = (store: NonceStore): Router => {
  const router = express.Router();

  router.post('/attest/nonce', async (req: Request, res: Response) => {
    const body = req.body as Partial<NonceRequest>;
    const serverIssuedAt = Date.now();
    const nonce = randomNonce();
    const record: StoredNonce = {
      nonce,
      serverIssuedAt,
      clientTs: Number.isFinite(body.clientTs) ? Number(body.clientTs) : 0,
      clientIp: req.ip ?? '',
      userAgent: req.header('user-agent') ?? '',
      userId: getRequestUserId(req),
      expiresAt: serverIssuedAt + Config.nonceTtlMs,
    };

    await store.put(record);

    const response: NonceResponse = {
      nonce,
      serverIssuedAt,
    };
    res.json(response);
  });

  return router;
};

export const correlateLatency =
  (store: NonceStore) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (req.path !== '/attest/verify') {
      next();
      return;
    }

    const nonce = (req.body as { nonce?: string }).nonce;
    const record = nonce ? await store.get(nonce) : undefined;
    if (!record) {
      req.attestationLatency = {
        rttMs: Number.POSITIVE_INFINITY,
        nonceAgeMs: Number.POSITIVE_INFINITY,
        clockSkewMs: Number.NaN,
        latencyAnomaly: true,
      };
      next();
      return;
    }

    const now = Date.now();
    const rttMs = now - record.serverIssuedAt;
    const clockSkewMs = record.clientTs - record.serverIssuedAt;
    req.attestationNonceRecord = record;
    req.attestationLatency = {
      rttMs,
      nonceAgeMs: rttMs,
      clockSkewMs,
      latencyAnomaly: rttMs > Config.maxAttestedLatencyMs || rttMs < 0,
    };
    next();
  };
