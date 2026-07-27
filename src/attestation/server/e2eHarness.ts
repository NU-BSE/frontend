import type { Request, Response, Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import Config from '../../../config/attestation.config';
import { getRequestUserId } from './nonceRoute';
import type { VelocityStore } from './velocity';
import type { ClassifierTrace } from '@attestation/shared/wire';

/**
 * Test-only endpoints used by the Detox device-lab suites (e2e/).
 *
 * They are mounted ONLY when `ATTESTATION_E2E_HARNESS_TOKEN` is set and the
 * process is not in production, and every request must present that token.
 * `createE2eHarnessRouter` returns undefined otherwise, so a production build
 * has no such route at all rather than a route that refuses requests.
 */

export type DecisionRecord = {
  userId: string;
  deviceId: string;
  tier: string;
  reasons: string[];
  trace?: ClassifierTrace;
  atMs: number;
};

export class DecisionRecorder {
  private readonly records = new Map<string, DecisionRecord>();

  record(record: DecisionRecord): void {
    this.records.set(record.userId, record);
  }

  get(userId: string): DecisionRecord | undefined {
    return this.records.get(userId);
  }
}

export const e2eHarnessEnabled = (): boolean =>
  Boolean(process.env.ATTESTATION_E2E_HARNESS_TOKEN) && !Config.isProduction;

export const createE2eHarnessRouter = (deps: {
  recorder: DecisionRecorder;
  velocityStore: VelocityStore;
}): Router | undefined => {
  const token = process.env.ATTESTATION_E2E_HARNESS_TOKEN;
  if (!token || Config.isProduction) return undefined;

  const router = express.Router();

  router.use('/attest/e2e', (req: Request, res: Response, next) => {
    if (req.header('x-e2e-harness-token') !== token) {
      res.status(404).end();
      return;
    }
    next();
  });

  /** The last classifier decision for a user, including the full trace. */
  router.get('/attest/e2e/last-trace', (req: Request, res: Response) => {
    const userId =
      (typeof req.query.userId === 'string' ? req.query.userId : undefined) ??
      getRequestUserId(req);
    const record = deps.recorder.get(userId);
    if (!record) {
      res.status(404).json({ ok: false, message: 'no decision recorded yet' });
      return;
    }
    res.json({ ok: true, ...record });
  });

  /**
   * Fills the velocity windows for the user's last-seen device so the BURST
   * scenario does not need 40 genuine Play Integrity tokens. It writes through
   * the same VelocityStore the DefaultRiskProvider reads, so the thresholds
   * under test are the production ones.
   */
  router.post('/attest/e2e/velocity-burst', async (req: Request, res: Response) => {
    const userId = getRequestUserId(req);
    const record = deps.recorder.get(userId);
    if (!record) {
      res.status(409).json({
        ok: false,
        message:
          'no device recorded for this user yet — run one real attestation first',
      });
      return;
    }
    const body = req.body as { requests?: number; windowMs?: number };
    const requests = Math.min(Math.max(Number(body.requests ?? 40), 1), 500);
    const windowMs = Math.min(Math.max(Number(body.windowMs ?? 30_000), 1), 60_000);
    const now = Date.now();

    for (let index = 0; index < requests; index += 1) {
      await deps.velocityStore.append(record.deviceId, {
        atMs: now - Math.floor((windowMs * index) / requests),
        nonce: randomUUID(),
        ip: req.ip ?? '127.0.0.1',
        asn: 'e2e',
        payloadHash: `e2e-${index}`,
      });
    }

    res.json({ ok: true, completed: requests, deviceId: record.deviceId });
  });

  return router;
};
