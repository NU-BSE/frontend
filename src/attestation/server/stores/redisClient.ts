import { createClient, type RedisClientType } from 'redis';
import Config from '../../../../config/attestation.config';

/**
 * Single shared Redis connection for every attestation store.
 *
 * Redis is the durable home for the short-lived, high-churn state: nonces,
 * velocity windows, recent WebAuthn ceremonies, native launch sessions and
 * attestation results. All of it used to live in process memory, which meant a
 * restart silently forgot every issued nonce and every device's velocity
 * history — an attacker only had to wait for a deploy.
 */
export type AttestationRedis = RedisClientType;

let clientPromise: Promise<AttestationRedis> | undefined;

export const redisKey = (...parts: string[]): string =>
  `${Config.redis.keyPrefix}${parts.join(':')}`;

export const connectRedis = async (
  url = Config.redis.url,
): Promise<AttestationRedis> => {
  if (!url) throw new Error('Redis URL is not configured');
  clientPromise ??= (async () => {
    const client = createClient({
      url,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 200, 5_000),
      },
    }) as AttestationRedis;
    client.on('error', (error: unknown) => {
      // node-redis reconnects on its own; log so the operator sees flapping.
      console.error('[attestation] Redis error', error);
    });
    await client.connect();
    return client;
  })();
  return clientPromise;
};

export const closeRedis = async (): Promise<void> => {
  const pending = clientPromise;
  clientPromise = undefined;
  if (!pending) return;
  const client = await pending;
  await client.quit();
};
