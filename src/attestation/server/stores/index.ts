import Config from '../../../../config/attestation.config';
import {
  InMemoryDeviceRegistry,
  type DeviceRegistry,
} from '../../../marketplace/deviceregistry';
import {
  createInMemoryAttestationResultStore,
  type AttestationResultStore,
} from '../attestationResult';
import { InMemoryNonceStore, type NonceStore } from '../nonceRoute';
import { InMemoryRecentWebAuthnStore } from '../recentWebAuthn';
import {
  InMemoryNativeLaunchStore,
  type NativeLaunchStore,
} from '../telegramAuth';
import {
  DefaultRiskProvider,
  InMemoryVelocityStore,
  type RiskProvider,
  type VelocityStore,
} from '../velocity';
import type { RecentWebAuthnResult, RecentWebAuthnStore } from '../verify';
import {
  InMemoryWebAuthnCredentialStore,
  type WebAuthnCredentialStore,
} from '../webauthn';
import { connectRedis } from './redisClient';
import {
  RedisAttestationResultStore,
  RedisNativeLaunchStore,
  RedisNonceStore,
  RedisRecentWebAuthnStore,
  RedisVelocityStore,
} from './redisStores';
import {
  PostgresDeviceRegistry,
  PostgresWebAuthnCredentialStore,
  getPool,
  migrate,
} from './postgresStores';

export type WritableRecentWebAuthnStore = RecentWebAuthnStore & {
  put(userId: string, result: RecentWebAuthnResult): Promise<void>;
};

export type AttestationStores = {
  nonceStore: NonceStore;
  velocityStore: VelocityStore;
  riskProvider: RiskProvider;
  recentWebAuthn: WritableRecentWebAuthnStore;
  launchStore: NativeLaunchStore;
  attestationResultStore: AttestationResultStore;
  deviceRegistry: DeviceRegistry;
  webAuthnCredentialStore: WebAuthnCredentialStore;
  /** What was actually wired up, for the boot log. */
  notes: string[];
  backends: { ephemeral: 'redis' | 'memory'; durable: 'postgres' | 'memory' };
};

/**
 * Chooses the storage backends.
 *
 * Redis holds the ephemeral, high-churn state (nonces, velocity windows, recent
 * WebAuthn ceremonies, launch sessions, attestation results); PostgreSQL holds
 * the durable records (device registry with the App Attest counter, WebAuthn
 * credentials, marketplace submissions).
 *
 * In-memory stores remain available for local development and unit tests, but
 * with `ATTESTATION_REQUIRE_PRODUCTION_DEPENDENCIES=1` (the default when
 * NODE_ENV=production) a missing Redis or database URL aborts startup instead of
 * quietly running a server that forgets every nonce on restart.
 */
export const createStores = async (): Promise<AttestationStores> => {
  const notes: string[] = [];
  const missing: string[] = [];

  let nonceStore: NonceStore;
  let velocityStore: VelocityStore;
  let recentWebAuthn: WritableRecentWebAuthnStore;
  let launchStore: NativeLaunchStore;
  let attestationResultStore: AttestationResultStore;
  let ephemeral: 'redis' | 'memory' = 'memory';

  if (Config.redis.url) {
    const redis = await connectRedis(Config.redis.url);
    nonceStore = new RedisNonceStore(redis);
    velocityStore = new RedisVelocityStore(redis);
    recentWebAuthn = new RedisRecentWebAuthnStore(redis);
    launchStore = new RedisNativeLaunchStore(redis);
    attestationResultStore = new RedisAttestationResultStore(redis);
    ephemeral = 'redis';
    notes.push('Redis: nonce, velocity, recent WebAuthn, launch, results');
  } else {
    missing.push('Redis (ATTESTATION_REDIS_URL) — nonce/velocity/session state');
    nonceStore = new InMemoryNonceStore();
    velocityStore = new InMemoryVelocityStore();
    recentWebAuthn = new InMemoryRecentWebAuthnStore();
    launchStore = new InMemoryNativeLaunchStore();
    attestationResultStore = createInMemoryAttestationResultStore();
  }

  let deviceRegistry: DeviceRegistry;
  let webAuthnCredentialStore: WebAuthnCredentialStore;
  let durable: 'postgres' | 'memory' = 'memory';

  if (Config.database.url) {
    const pool = getPool(Config.database.url);
    if (Config.database.autoMigrate) await migrate(pool);
    deviceRegistry = new PostgresDeviceRegistry(pool);
    webAuthnCredentialStore = new PostgresWebAuthnCredentialStore(pool);
    durable = 'postgres';
    notes.push('PostgreSQL: device registry, WebAuthn credentials, marketplace');
  } else {
    missing.push(
      'PostgreSQL (ATTESTATION_DATABASE_URL) — device registry and WebAuthn credentials',
    );
    deviceRegistry = new InMemoryDeviceRegistry();
    webAuthnCredentialStore = new InMemoryWebAuthnCredentialStore();
  }

  if (missing.length > 0) {
    if (Config.requireProductionDependencies) {
      throw new Error(
        `Persistent storage is not configured:\n  - ${missing.join('\n  - ')}`,
      );
    }
    notes.push(
      ...missing.map((item) => `IN-MEMORY FALLBACK (data lost on restart) — ${item}`),
    );
  }

  return {
    nonceStore,
    velocityStore,
    // The full behavioural analyser, not a fixed-value stub.
    riskProvider: new DefaultRiskProvider(velocityStore),
    recentWebAuthn,
    launchStore,
    attestationResultStore,
    deviceRegistry,
    webAuthnCredentialStore,
    notes,
    backends: { ephemeral, durable },
  };
};
