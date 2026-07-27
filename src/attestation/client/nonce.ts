import { serverBaseUrl } from './runtimeConfig';
import { userHeaders } from './userSession';
import type { NonceRequest, NonceResponse } from '@attestation/shared/wire';

export type ClientNonce = {
  nonce: string;
  issuedAt: number;
  serverIssuedAt: number;
};

const NONCE_TIMEOUT_MS = 10_000;

export const requestNonce = async (): Promise<ClientNonce> => {
  const issuedAt = Date.now();
  const body: NonceRequest = { clientTs: issuedAt };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NONCE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${serverBaseUrl}/attest/nonce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...userHeaders() },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `Nonce request timed out after ${NONCE_TIMEOUT_MS}ms (server ${serverBaseUrl} unreachable)`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Nonce request failed with HTTP ${response.status}`);
  }

  const json = (await response.json()) as NonceResponse;
  return {
    nonce: json.nonce,
    issuedAt,
    serverIssuedAt: json.serverIssuedAt,
  };
};

export const measureAttestationRtt = async <T>(
  fn: () => Promise<T>,
): Promise<{ result: T; rttMs: number }> => {
  const started = performance.now();
  const result = await fn();
  return {
    result,
    rttMs: performance.now() - started,
  };
};
