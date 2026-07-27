-- Durable attestation state.
--
-- Device handles (Play Integrity device recall handles, App Attest keyIds) are
-- pseudonymous but stable, so they are PII under GDPR/CCPA: keep this schema in
-- the same database as user records so deletion requests cover it, and never
-- copy these columns into analytics stores.

CREATE TABLE IF NOT EXISTS attestation_devices (
  device_id                  TEXT PRIMARY KEY,
  user_id                    TEXT NOT NULL,
  platform                   TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  key_id                     TEXT,
  public_key_pem             TEXT,
  last_counter               BIGINT,
  first_seen_at_ms           BIGINT NOT NULL,
  strong_integrity_since_ms  BIGINT,
  model_family               TEXT,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attestation_devices_user_id_idx
  ON attestation_devices (user_id);

CREATE TABLE IF NOT EXISTS attestation_webauthn_credentials (
  user_id         TEXT PRIMARY KEY,
  credential_id   TEXT NOT NULL,
  public_key      BYTEA NOT NULL,
  counter         BIGINT NOT NULL DEFAULT 0,
  aaguid          TEXT,
  transports      TEXT[],
  cross_platform  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attestation_webauthn_credentials_credential_id_idx
  ON attestation_webauthn_credentials (credential_id);

CREATE TABLE IF NOT EXISTS stock_selling_devices (
  submission_id       TEXT PRIMARY KEY,
  seller_user_id      TEXT NOT NULL,
  device_external_id  TEXT,
  manufacturer        TEXT NOT NULL,
  model               TEXT NOT NULL,
  serial_hash         TEXT,
  imei_hash           TEXT,
  condition           TEXT NOT NULL CHECK (condition IN ('new', 'good', 'fair', 'parts')),
  asking_price        NUMERIC,
  currency            TEXT,
  source              TEXT NOT NULL CHECK (source IN ('telegramMiniApp', 'androidNative')),
  status              TEXT NOT NULL CHECK (status IN ('submitted', 'attestation_pending', 'listed', 'rejected')),
  created_at_ms       BIGINT NOT NULL,
  updated_at_ms       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS stock_selling_devices_seller_idx
  ON stock_selling_devices (seller_user_id);

-- JIT signing key ledger: which kid was active when, so a rotation can be
-- audited and the overlap window verified after the fact.
CREATE TABLE IF NOT EXISTS attestation_jit_keys (
  kid             TEXT PRIMARY KEY,
  public_jwk      JSONB NOT NULL,
  provider        TEXT NOT NULL,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at      TIMESTAMPTZ
);
