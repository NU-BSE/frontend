import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import Config from '../../../../config/attestation.config';
import type {
  DeviceRegistry,
  RegisteredDevice,
  StockSellingDeviceRecord,
} from '../../../marketplace/deviceregistry';
import type {
  WebAuthnCredential,
  WebAuthnCredentialStore,
} from '../webauthn';

let pool: Pool | undefined;

export const getPool = (url = Config.database.url): Pool => {
  if (!url) throw new Error('Database URL is not configured');
  pool ??= new Pool({
    connectionString: url,
    max: Config.database.poolMax,
    ...(Config.database.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  return pool;
};

export const closePool = async (): Promise<void> => {
  const pending = pool;
  pool = undefined;
  await pending?.end();
};

const schemaSqlPath = (): string => {
  // Works both when transpiled to CJS (tsx / ts-jest) and when the file is run
  // from the repo root.
  const candidates = [
    typeof __dirname === 'string' ? path.join(__dirname, 'schema.sql') : undefined,
    path.resolve(
      process.cwd(),
      'src/attestation/server/stores/schema.sql',
    ),
  ].filter((value): value is string => value !== undefined);
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('stores/schema.sql could not be located');
};

/** Applies the bundled idempotent schema. */
export const migrate = async (
  client: Pool | PoolClient = getPool(),
): Promise<void> => {
  await client.query(readFileSync(schemaSqlPath(), 'utf8'));
};

type DeviceRow = {
  device_id: string;
  user_id: string;
  platform: 'android' | 'ios';
  key_id: string | null;
  public_key_pem: string | null;
  last_counter: string | null;
  first_seen_at_ms: string;
  strong_integrity_since_ms: string | null;
  model_family: string | null;
};

const toDevice = (row: DeviceRow): RegisteredDevice => ({
  deviceId: row.device_id,
  userId: row.user_id,
  platform: row.platform,
  firstSeenAtMs: Number(row.first_seen_at_ms),
  ...(row.key_id ? { keyId: row.key_id } : {}),
  ...(row.public_key_pem ? { publicKeyPem: row.public_key_pem } : {}),
  ...(row.last_counter !== null ? { lastCounter: Number(row.last_counter) } : {}),
  ...(row.strong_integrity_since_ms !== null
    ? { strongIntegritySinceMs: Number(row.strong_integrity_since_ms) }
    : {}),
  ...(row.model_family ? { modelFamily: row.model_family } : {}),
});

type StockRow = {
  submission_id: string;
  seller_user_id: string;
  device_external_id: string | null;
  manufacturer: string;
  model: string;
  serial_hash: string | null;
  imei_hash: string | null;
  condition: StockSellingDeviceRecord['condition'];
  asking_price: string | null;
  currency: string | null;
  source: StockSellingDeviceRecord['source'];
  status: StockSellingDeviceRecord['status'];
  created_at_ms: string;
  updated_at_ms: string;
};

const toStockRecord = (row: StockRow): StockSellingDeviceRecord => ({
  submissionId: row.submission_id,
  sellerUserId: row.seller_user_id,
  manufacturer: row.manufacturer,
  model: row.model,
  condition: row.condition,
  source: row.source,
  status: row.status,
  createdAtMs: Number(row.created_at_ms),
  updatedAtMs: Number(row.updated_at_ms),
  ...(row.device_external_id ? { deviceExternalId: row.device_external_id } : {}),
  ...(row.serial_hash ? { serialHash: row.serial_hash } : {}),
  ...(row.imei_hash ? { imeiHash: row.imei_hash } : {}),
  ...(row.asking_price !== null ? { askingPrice: Number(row.asking_price) } : {}),
  ...(row.currency ? { currency: row.currency } : {}),
});

/**
 * Durable device registry. The App Attest assertion counter lives here, so
 * losing this table means losing the replay guard — it must never move back
 * into process memory.
 */
export class PostgresDeviceRegistry implements DeviceRegistry {
  constructor(private readonly db: Pool = getPool()) {}

  async get(deviceId: string): Promise<RegisteredDevice | undefined> {
    const { rows } = await this.db.query<DeviceRow>(
      'SELECT * FROM attestation_devices WHERE device_id = $1',
      [deviceId],
    );
    const row = rows[0];
    return row ? toDevice(row) : undefined;
  }

  async upsert(device: RegisteredDevice): Promise<RegisteredDevice> {
    const { rows } = await this.db.query<DeviceRow>(
      `INSERT INTO attestation_devices (
         device_id, user_id, platform, key_id, public_key_pem, last_counter,
         first_seen_at_ms, strong_integrity_since_ms, model_family
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (device_id) DO UPDATE SET
         user_id        = EXCLUDED.user_id,
         platform       = EXCLUDED.platform,
         key_id         = COALESCE(EXCLUDED.key_id, attestation_devices.key_id),
         public_key_pem = COALESCE(EXCLUDED.public_key_pem, attestation_devices.public_key_pem),
         -- The counter is monotonic: never let a stale write move it backwards.
         last_counter   = GREATEST(
                            COALESCE(EXCLUDED.last_counter, 0),
                            COALESCE(attestation_devices.last_counter, 0)
                          ),
         first_seen_at_ms = LEAST(
                              EXCLUDED.first_seen_at_ms,
                              attestation_devices.first_seen_at_ms
                            ),
         strong_integrity_since_ms = COALESCE(
                                       attestation_devices.strong_integrity_since_ms,
                                       EXCLUDED.strong_integrity_since_ms
                                     ),
         model_family   = COALESCE(EXCLUDED.model_family, attestation_devices.model_family),
         updated_at     = now()
       RETURNING *`,
      [
        device.deviceId,
        device.userId,
        device.platform,
        device.keyId ?? null,
        device.publicKeyPem ?? null,
        device.lastCounter ?? null,
        device.firstSeenAtMs,
        device.strongIntegritySinceMs ?? null,
        device.modelFamily ?? null,
      ],
    );
    return toDevice(rows[0]!);
  }

  async updateCounter(deviceId: string, counter: number): Promise<void> {
    await this.db.query(
      `UPDATE attestation_devices
          SET last_counter = GREATEST(COALESCE(last_counter, 0), $2),
              updated_at = now()
        WHERE device_id = $1`,
      [deviceId, counter],
    );
  }

  async submitStockSellingDevice(
    record: StockSellingDeviceRecord,
  ): Promise<StockSellingDeviceRecord> {
    const { rows } = await this.db.query<StockRow>(
      `INSERT INTO stock_selling_devices (
         submission_id, seller_user_id, device_external_id, manufacturer, model,
         serial_hash, imei_hash, condition, asking_price, currency, source,
         status, created_at_ms, updated_at_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (submission_id) DO UPDATE SET
         status        = EXCLUDED.status,
         asking_price  = EXCLUDED.asking_price,
         currency      = EXCLUDED.currency,
         updated_at_ms = EXCLUDED.updated_at_ms
       RETURNING *`,
      [
        record.submissionId,
        record.sellerUserId,
        record.deviceExternalId ?? null,
        record.manufacturer,
        record.model,
        record.serialHash ?? null,
        record.imeiHash ?? null,
        record.condition,
        record.askingPrice ?? null,
        record.currency ?? null,
        record.source,
        record.status,
        record.createdAtMs,
        record.updatedAtMs,
      ],
    );
    return toStockRecord(rows[0]!);
  }

  async listStockSellingDevices(
    sellerUserId?: string,
  ): Promise<StockSellingDeviceRecord[]> {
    const { rows } = sellerUserId
      ? await this.db.query<StockRow>(
          'SELECT * FROM stock_selling_devices WHERE seller_user_id = $1 ORDER BY created_at_ms DESC',
          [sellerUserId],
        )
      : await this.db.query<StockRow>(
          'SELECT * FROM stock_selling_devices ORDER BY created_at_ms DESC',
        );
    return rows.map(toStockRecord);
  }
}

type CredentialRow = {
  credential_id: string;
  public_key: Buffer;
  counter: string;
  aaguid: string | null;
  transports: string[] | null;
  cross_platform: boolean;
};

export class PostgresWebAuthnCredentialStore implements WebAuthnCredentialStore {
  constructor(private readonly db: Pool = getPool()) {}

  async getForUser(userId: string): Promise<WebAuthnCredential | undefined> {
    const { rows } = await this.db.query<CredentialRow>(
      'SELECT * FROM attestation_webauthn_credentials WHERE user_id = $1',
      [userId],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      credentialId: row.credential_id,
      publicKey: new Uint8Array(row.public_key),
      counter: Number(row.counter),
      crossPlatform: row.cross_platform,
      ...(row.aaguid ? { aaguid: row.aaguid } : {}),
      ...(row.transports && row.transports.length > 0
        ? { transports: row.transports }
        : {}),
    };
  }

  async saveForUser(
    userId: string,
    credential: WebAuthnCredential,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO attestation_webauthn_credentials (
         user_id, credential_id, public_key, counter, aaguid, transports, cross_platform
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id) DO UPDATE SET
         credential_id  = EXCLUDED.credential_id,
         public_key     = EXCLUDED.public_key,
         -- Authenticator sign counters are monotonic; a lower value is a replay.
         counter        = GREATEST(attestation_webauthn_credentials.counter, EXCLUDED.counter),
         aaguid         = COALESCE(EXCLUDED.aaguid, attestation_webauthn_credentials.aaguid),
         transports     = COALESCE(EXCLUDED.transports, attestation_webauthn_credentials.transports),
         cross_platform = EXCLUDED.cross_platform,
         updated_at     = now()`,
      [
        userId,
        credential.credentialId,
        Buffer.from(credential.publicKey),
        credential.counter,
        credential.aaguid ?? null,
        credential.transports ?? null,
        credential.crossPlatform,
      ],
    );
  }
}
