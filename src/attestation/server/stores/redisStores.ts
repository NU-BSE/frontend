import Config from '../../../../config/attestation.config';
import { redisKey, type AttestationRedis } from './redisClient';
import type { NonceStore, StoredNonce } from '../nonceRoute';
import type { RecentWebAuthnResult, RecentWebAuthnStore } from '../verify';
import type { NativeLaunchSession, NativeLaunchStore } from '../telegramAuth';
import type { AttestationResultStore } from '../attestationResult';
import type { VelocityStore } from '../velocity';
import type { AttestationResultRecord } from '@attestation/shared/wire';

const parse = <T>(value: string | null | undefined): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

/**
 * Atomic "read and delete" so that two concurrent /attest/verify requests can
 * never both consume the same nonce. GETDEL is a single Redis command, hence
 * atomic across processes; the user binding is checked after the delete, which
 * means a nonce presented by the wrong user is burned rather than left for a
 * retry.
 */
const CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then return nil end
redis.call('DEL', KEYS[1])
return value
`;

export class RedisNonceStore implements NonceStore {
  constructor(private readonly redis: AttestationRedis) {}

  private key(nonce: string): string {
    return redisKey('nonce', nonce);
  }

  async put(record: StoredNonce): Promise<void> {
    const ttlMs = Math.max(1, record.expiresAt - Date.now());
    await this.redis.set(this.key(record.nonce), JSON.stringify(record), {
      PX: ttlMs,
      NX: true,
    });
  }

  async get(nonce: string): Promise<StoredNonce | undefined> {
    const record = parse<StoredNonce>(await this.redis.get(this.key(nonce)));
    if (!record) return undefined;
    if (record.expiresAt < Date.now()) {
      await this.redis.del(this.key(nonce));
      return undefined;
    }
    return record;
  }

  async consume(
    nonce: string,
    userId: string,
  ): Promise<StoredNonce | undefined> {
    const raw = (await this.redis.eval(CONSUME_SCRIPT, {
      keys: [this.key(nonce)],
    })) as string | null;
    const record = parse<StoredNonce>(raw);
    if (!record) return undefined;
    if (record.userId !== userId) return undefined;
    if (record.expiresAt < Date.now()) return undefined;
    return record;
  }
}

export class RedisRecentWebAuthnStore implements RecentWebAuthnStore {
  constructor(
    private readonly redis: AttestationRedis,
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}

  private key(userId: string): string {
    return redisKey('webauthn:recent', userId);
  }

  async put(userId: string, result: RecentWebAuthnResult): Promise<void> {
    await this.redis.set(this.key(userId), JSON.stringify(result), {
      PX: this.ttlMs,
    });
  }

  async get(userId: string): Promise<RecentWebAuthnResult | undefined> {
    const result = parse<RecentWebAuthnResult>(
      await this.redis.get(this.key(userId)),
    );
    if (!result) return undefined;
    if (Date.now() - result.verifiedAtMs > this.ttlMs) {
      await this.redis.del(this.key(userId));
      return undefined;
    }
    return result;
  }
}

export class RedisNativeLaunchStore implements NativeLaunchStore {
  constructor(private readonly redis: AttestationRedis) {}

  private key(launchToken: string): string {
    return redisKey('launch', launchToken);
  }

  async put(session: NativeLaunchSession): Promise<void> {
    const ttlMs = Math.max(1, session.expiresAtMs - Date.now());
    await this.redis.set(this.key(session.launchToken), JSON.stringify(session), {
      PX: ttlMs,
    });
  }

  async consume(launchToken: string): Promise<NativeLaunchSession | undefined> {
    const raw = (await this.redis.eval(CONSUME_SCRIPT, {
      keys: [this.key(launchToken)],
    })) as string | null;
    const session = parse<NativeLaunchSession>(raw);
    if (!session) return undefined;
    if (session.expiresAtMs < Date.now() || session.consumedAtMs) {
      return undefined;
    }
    return { ...session, consumedAtMs: Date.now() };
  }
}

export class RedisAttestationResultStore implements AttestationResultStore {
  constructor(
    private readonly redis: AttestationRedis,
    private readonly ttlMs = 10 * 60 * 1000,
  ) {}

  private key(ref: string): string {
    return redisKey('result', ref);
  }

  async put(record: AttestationResultRecord): Promise<void> {
    await this.redis.set(this.key(record.ref), JSON.stringify(record), {
      PX: this.ttlMs,
    });
  }

  async get(ref: string): Promise<AttestationResultRecord | undefined> {
    const record = parse<AttestationResultRecord>(
      await this.redis.get(this.key(ref)),
    );
    if (!record) return undefined;
    if (Date.now() - record.attestedAtMs > this.ttlMs) {
      await this.redis.del(this.key(ref));
      return undefined;
    }
    return record;
  }
}

type VelocityEvent = {
  atMs: number;
  nonce: string;
  ip: string;
  asn: string;
  payloadHash: string;
};

/**
 * Sliding-window velocity history in a sorted set scored by timestamp, so the
 * 1m / 1h / 24h windows are plain ZRANGEBYSCORE reads and expiry is a single
 * ZREMRANGEBYSCORE. Survives restarts, shared across server instances.
 */
export class RedisVelocityStore implements VelocityStore {
  constructor(
    private readonly redis: AttestationRedis,
    private readonly retentionMs = Config.velocity.retentionHours *
      60 *
      60 *
      1000,
  ) {}

  private key(deviceId: string): string {
    return redisKey('velocity', deviceId);
  }

  async append(deviceId: string, event: VelocityEvent): Promise<void> {
    const key = this.key(deviceId);
    const multi = this.redis.multi();
    // The member must be unique per event or ZADD would overwrite: the nonce is
    // single-use, so it is a natural discriminator.
    multi.zAdd(key, {
      score: event.atMs,
      value: JSON.stringify(event),
    });
    multi.zRemRangeByScore(key, 0, event.atMs - this.retentionMs);
    multi.pExpire(key, this.retentionMs);
    await multi.exec();
  }

  async list(deviceId: string, sinceMs: number): Promise<VelocityEvent[]> {
    const raw = await this.redis.zRangeByScore(
      this.key(deviceId),
      sinceMs,
      '+inf',
    );
    return raw
      .map((value) => parse<VelocityEvent>(value))
      .filter((event): event is VelocityEvent => event !== undefined);
  }
}
