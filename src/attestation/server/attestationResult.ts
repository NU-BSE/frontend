import type { Request, Response, Router } from 'express';
import express from 'express';
import type {
  AttestationResultRecord,
  GetAttestationResultResponse,
  SubmitAttestationResultRequest,
  SubmitAttestationResultResponse,
} from '@attestation/shared/wire';

/**
 * Stores the outcome of a native attestation so it can be handed back to the
 * Telegram Mini App (or bot) after the native app deep-links the user home.
 *
 * Flow:
 *  1. Native app finishes attestation and POSTs the result here, keyed by a
 *     short `ref` (the launch session id).
 *  2. Native app opens https://t.me/<bot>?startapp=<ref>, reopening the Mini App.
 *  3. Mini App reads `start_param` (= ref) and GETs the result to display it.
 */
export type AttestationResultStore = {
  put(record: AttestationResultRecord): Promise<void>;
  get(ref: string): Promise<AttestationResultRecord | undefined>;
};

const REF_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;

export const createInMemoryAttestationResultStore = (
  ttlMs = 10 * 60 * 1000,
): AttestationResultStore => {
  const records = new Map<string, AttestationResultRecord>();
  return {
    async put(record) {
      records.set(record.ref, record);
    },
    async get(ref) {
      const record = records.get(ref);
      if (!record) return undefined;
      if (Date.now() - record.attestedAtMs > ttlMs) {
        records.delete(ref);
        return undefined;
      }
      return record;
    },
  };
};

export const createAttestationResultRouter = (deps: {
  store: AttestationResultStore;
}): Router => {
  const router = express.Router();

  router.post('/attest/result', async (req: Request, res: Response) => {
    const body = req.body as Partial<SubmitAttestationResultRequest>;
    if (!body.ref || !REF_PATTERN.test(body.ref)) {
      res.status(400).json({
        ok: false,
        message: 'ref must be 8-128 URL-safe characters',
      } satisfies SubmitAttestationResultResponse);
      return;
    }
    if (!body.customUserId || typeof body.ok !== 'boolean') {
      res.status(400).json({
        ok: false,
        message: 'customUserId and ok are required',
      } satisfies SubmitAttestationResultResponse);
      return;
    }

    const record: AttestationResultRecord = {
      ref: body.ref,
      customUserId: body.customUserId,
      ok: body.ok,
      attestedAtMs: Date.now(),
      ...(body.telegramUserId ? { telegramUserId: body.telegramUserId } : {}),
      ...(body.deviceModel ? { deviceModel: body.deviceModel } : {}),
      ...(body.platform ? { platform: body.platform } : {}),
      ...(body.trustTier ? { trustTier: body.trustTier } : {}),
      ...(body.detail ? { detail: body.detail } : {}),
    };
    await deps.store.put(record);
    res.json({
      ok: true,
      ref: record.ref,
    } satisfies SubmitAttestationResultResponse);
  });

  router.get('/attest/result/:ref', async (req: Request, res: Response) => {
    const ref = Array.isArray(req.params.ref)
      ? req.params.ref[0]
      : req.params.ref;
    if (!ref || !REF_PATTERN.test(ref)) {
      res.status(400).json({
        ok: false,
        message: 'invalid ref',
      } satisfies GetAttestationResultResponse);
      return;
    }
    const result = await deps.store.get(ref);
    if (!result) {
      res.status(404).json({
        ok: false,
        message: 'no attestation result for this reference (expired or unknown)',
      } satisfies GetAttestationResultResponse);
      return;
    }
    res.json({ ok: true, result } satisfies GetAttestationResultResponse);
  });

  return router;
};
