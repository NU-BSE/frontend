/**
 * Attestation configuration — the single runtime source.
 *
 * CommonJS on purpose. `app.config.js` has to `require` this at build time to
 * bake `AttestationConfig.public` into `expo.extra.attestation`, and a `.ts`
 * module cannot be required from a plain CommonJS Expo config without a
 * transpile step. `attestation.config.d.ts` beside it types the same object for
 * the TypeScript tree, so there is one implementation and one set of defaults
 * rather than two files that drift — which the two originals already had,
 * disagreeing on bundle id, WebAuthn relying party and several fallbacks.
 *
 * Defaults are Creepy.IM's, not the project this came from: the package is
 * `im.creepy.app` and the scheme is `creepyim`, both matching app.json.
 *
 * `process.env` is read here and read honestly. In Node — the Expo config, the
 * server — `.env` is loaded and these resolve. Inside the RN bundle they do
 * not: babel-preset-expo inlines only `EXPO_PUBLIC_*`, and only as literal
 * member expressions, so the dynamic lookups below always yield the fallbacks
 * on device. That is why `client/runtimeConfig.ts` reads
 * `expo.extra.attestation` instead of importing this directly, and why
 * `public` exists at all.
 */

const env = process.env;

const getString = (names, fallback) => {
  for (const name of Array.isArray(names) ? names : [names]) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return fallback;
};

const getOptionalString = (names) => {
  for (const name of Array.isArray(names) ? names : [names]) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
};

const getNumber = (names, fallback) => {
  for (const name of Array.isArray(names) ? names : [names]) {
    const raw = env[name];
    if (!raw) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const getBoolean = (names, fallback) => {
  for (const name of Array.isArray(names) ? names : [names]) {
    const raw = env[name];
    if (!raw) continue;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  }
  return fallback;
};

const getEnum = (names, allowed, fallback) => {
  for (const name of Array.isArray(names) ? names : [names]) {
    const value = env[name]?.trim().toLowerCase();
    if (value && allowed.includes(value)) return value;
  }
  return fallback;
};

const getCsv = (names, fallback = '') =>
  getString(names, fallback)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const appEnv = getString('NODE_ENV', 'development');
const isProduction = appEnv === 'production';

const serverBaseUrl = getString(
  'ATTESTATION_SERVER_BASE_URL',
  'http://localhost:3000',
);
const attestationDebug = getBoolean('ATTESTATION_DEBUG', false);
const nonceTtlMs =
  getNumber('ATTESTATION_NONCE_TTL_MS', NaN) ||
  getNumber('ATTESTATION_NONCE_TTL_SECONDS', 90) * 1000;
const maxAttestedLatencyMs = getNumber(
  ['ATTESTATION_MAX_ATTESTED_LATENCY_MS', 'ATTESTATION_MAX_LATENCY_MS'],
  2500,
);

const androidPackage = getString(
  ['ATTESTATION_ANDROID_PACKAGE_NAME', 'ANDROID_PACKAGE_NAME'],
  'im.creepy.app',
);
const scheme = getString('ATTESTATION_TELEGRAM_NATIVE_SCHEME', 'creepyim');
const telegramBotUsername = getString('ATTESTATION_TELEGRAM_BOT_USERNAME', '');

const webauthnRpId = getString(
  ['ATTESTATION_WEBAUTHN_RP_ID', 'WEBAUTHN_RP_ID'],
  'creepy.im',
);
const webauthnRpName = getString(
  ['ATTESTATION_WEBAUTHN_RP_NAME', 'WEBAUTHN_RP_NAME'],
  'Creepy.IM',
);
const webauthnOrigin = getString(
  ['ATTESTATION_WEBAUTHN_ORIGIN', 'WEBAUTHN_ORIGIN'],
  'https://creepy.im',
);

const AttestationConfig = {
  env: appEnv,
  isProduction,
  /**
   * Whether a missing production dependency is fatal rather than degraded.
   *
   * Defaults to production: a server that quietly falls back to an in-memory
   * store or an unsigned token is worse than one that refuses to start, and
   * the fallbacks exist for development.
   */
  requireProductionDependencies: getBoolean(
    'ATTESTATION_REQUIRE_PRODUCTION_DEPENDENCIES',
    isProduction,
  ),

  serverBaseUrl,
  attestationDebug,
  nonceTtlMs,
  maxAttestedLatencyMs,

  android: {
    packageName: androidPackage,
    playIntegrityProjectNumber: getOptionalString([
      'ATTESTATION_ANDROID_PLAY_INTEGRITY_PROJECT_NUMBER',
      'PLAY_INTEGRITY_PROJECT_NUMBER',
    ]),
    expectedCertificateSha256: getCsv([
      'ATTESTATION_ANDROID_CERT_SHA256',
      'ANDROID_CERT_SHA256',
    ]),
    keyAttestation: {
      /** Chain to a Google hardware-attestation root, rather than trusting the leaf. */
      requireTrustedRoot: getBoolean(
        'ATTESTATION_ANDROID_KEY_REQUIRE_TRUSTED_ROOT',
        isProduction,
      ),
      /** StrongBox is not on every device, so this is opt-in even in production. */
      requireStrongBox: getBoolean(
        'ATTESTATION_ANDROID_KEY_REQUIRE_STRONGBOX',
        false,
      ),
      /** A software security level means the key is not hardware-backed at all. */
      allowSoftwareSecurityLevel: getBoolean(
        'ATTESTATION_ANDROID_KEY_ALLOW_SOFTWARE',
        !isProduction,
      ),
      revocationEnabled: getBoolean(
        'ATTESTATION_ANDROID_KEY_REVOCATION_ENABLED',
        isProduction,
      ),
      revocationStatusUrl: getString(
        'ATTESTATION_ANDROID_KEY_REVOCATION_STATUS_URL',
        'https://android.googleapis.com/attestation/status',
      ),
      trustedRootsPem: getOptionalString(
        'ATTESTATION_ANDROID_KEY_TRUSTED_ROOTS_PEM',
      ),
      trustedRootsPath: getOptionalString(
        'ATTESTATION_ANDROID_KEY_TRUSTED_ROOTS_PATH',
      ),
    },
  },

  ios: {
    teamId: getString(['ATTESTATION_IOS_TEAM_ID', 'APP_ATTEST_TEAM_ID'], ''),
    bundleId: getString(
      ['ATTESTATION_IOS_BUNDLE_ID', 'IOS_BUNDLE_ID'],
      'im.creepy.app',
    ),
    appAttestEnvironment: getEnum(
      ['ATTESTATION_IOS_APP_ATTEST_ENVIRONMENT', 'APP_ATTEST_ENVIRONMENT'],
      ['development', 'production'],
      'development',
    ),
  },

  webauthn: {
    rpId: webauthnRpId,
    rpName: webauthnRpName,
    origin: webauthnOrigin,
    associatedDomains: getCsv(
      ['ATTESTATION_WEBAUTHN_ASSOCIATED_DOMAINS', 'WEBAUTHN_ASSOCIATED_DOMAINS'],
      `webcredentials:${webauthnRpId}`,
    ),
    mds3Url: getString(
      ['ATTESTATION_WEBAUTHN_MDS3_URL', 'WEBAUTHN_MDS3_URL'],
      'https://mds3.fidoalliance.org/',
    ),
  },

  telegram: {
    botToken: getString(
      ['ATTESTATION_TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN'],
      '',
    ),
    botUsername: telegramBotUsername,
    initDataMaxAgeSeconds: getNumber(
      [
        'ATTESTATION_TELEGRAM_INIT_DATA_MAX_AGE_SECONDS',
        'TELEGRAM_INIT_DATA_MAX_AGE_SECONDS',
      ],
      300,
    ),
    nativeLaunchTtlSeconds: getNumber(
      [
        'ATTESTATION_TELEGRAM_NATIVE_LAUNCH_TTL_SECONDS',
        'TELEGRAM_NATIVE_LAUNCH_TTL_SECONDS',
      ],
      60,
    ),
    nativeScheme: scheme,
    nativeLaunchScheme: getString(
      [
        'ATTESTATION_TELEGRAM_NATIVE_LAUNCH_SCHEME',
        'TELEGRAM_NATIVE_LAUNCH_SCHEME',
      ],
      `${scheme}://native-launch`,
    ),
    androidPackage: getString(
      'ATTESTATION_TELEGRAM_ANDROID_PACKAGE',
      androidPackage,
    ),
    launchTtlMs: getNumber('ATTESTATION_TELEGRAM_LAUNCH_TTL_MS', 180000),
  },

  jit: {
    apiAudience: getString('JIT_API_AUDIENCE', 'sensitive-api'),
    ttlByTierSeconds: {
      RESTRICTED: getNumber('JIT_TTL_RESTRICTED_SECONDS', 60),
      STANDARD: getNumber('JIT_TTL_STANDARD_SECONDS', 120),
      ELEVATED: getNumber('JIT_TTL_ELEVATED_SECONDS', 120),
      HIGHEST: getNumber('JIT_TTL_HIGHEST_SECONDS', 180),
    },
    signer: {
      /**
       * `local` generates an ephemeral key at boot: fine for development,
       * useless across restarts, which is why production defaults elsewhere.
       */
      provider: getEnum(
        'JIT_SIGNER_PROVIDER',
        ['gcpKms', 'env', 'local'],
        'local',
      ),
      activeKid: getString('JIT_SIGNER_ACTIVE_KID', 'dev'),
      activePrivateKeyPem: getOptionalString('JIT_SIGNER_ACTIVE_PRIVATE_KEY_PEM'),
      retiredPublicKeysJson: getOptionalString(
        'JIT_SIGNER_RETIRED_PUBLIC_KEYS_JSON',
      ),
      activeKeyCreatedAt: getOptionalString('JIT_SIGNER_ACTIVE_KEY_CREATED_AT'),
      rotationIntervalDays: getNumber('JIT_SIGNER_ROTATION_INTERVAL_DAYS', 90),
      gcpKms: {
        keyVersionName: getOptionalString('JIT_SIGNER_GCP_KMS_KEY_VERSION_NAME'),
        retiredKeyVersionNames: getCsv(
          'JIT_SIGNER_GCP_KMS_RETIRED_KEY_VERSION_NAMES',
        ),
      },
    },
  },

  velocity: {
    burstRequestsPerMinute: getNumber(
      [
        'ATTESTATION_VELOCITY_BURST_REQUESTS_PER_MINUTE',
        'ATTESTATION_BURST_REQUESTS_PER_MINUTE',
      ],
      30,
    ),
    ipHoppingDistinctIps1h: getNumber(
      [
        'ATTESTATION_VELOCITY_IP_HOPPING_DISTINCT_IPS_1H',
        'ATTESTATION_IP_HOPPING_DISTINCT_IPS_1H',
      ],
      5,
    ),
    asnHoppingDistinctAsns1h: getNumber(
      [
        'ATTESTATION_VELOCITY_ASN_HOPPING_DISTINCT_ASNS_1H',
        'ATTESTATION_ASN_HOPPING_DISTINCT_ASNS_1H',
      ],
      2,
    ),
    lowEntropyBitsPerSymbol: getNumber(
      [
        'ATTESTATION_VELOCITY_LOW_ENTROPY_BITS_PER_SYMBOL',
        'ATTESTATION_LOW_ENTROPY_BITS_PER_SYMBOL',
      ],
      2,
    ),
    /** How long velocity evidence is kept before it stops being evidence. */
    retentionHours: getNumber('ATTESTATION_VELOCITY_RETENTION_HOURS', 24),
  },

  asn: {
    provider: getEnum('ATTESTATION_ASN_PROVIDER', ['none', 'ipinfo'], 'none'),
    ipinfoToken: getOptionalString('ATTESTATION_ASN_IPINFO_TOKEN'),
  },

  database: {
    /** Empty means no Postgres: the stores fall back to memory. */
    url: getString(['ATTESTATION_DATABASE_URL', 'DATABASE_URL'], ''),
    poolMax: getNumber('ATTESTATION_DATABASE_POOL_MAX', 10),
    ssl: getBoolean('ATTESTATION_DATABASE_SSL', false),
    autoMigrate: getBoolean('ATTESTATION_DATABASE_AUTO_MIGRATE', !isProduction),
  },

  redis: {
    /** Empty means no Redis: nonces and velocity live in memory. */
    url: getString(['ATTESTATION_REDIS_URL', 'REDIS_URL'], ''),
    keyPrefix: getString('ATTESTATION_REDIS_KEY_PREFIX', 'creepyim:attest:'),
  },

  google: {
    serviceAccountJson: getOptionalString([
      'ATTESTATION_GOOGLE_SERVICE_ACCOUNT_JSON',
      'GOOGLE_SERVICE_ACCOUNT_JSON',
    ]),
    serviceAccountKeyFile: getOptionalString([
      'ATTESTATION_GOOGLE_SERVICE_ACCOUNT_KEY_FILE',
      'GOOGLE_APPLICATION_CREDENTIALS',
    ]),
  },

  /**
   * The subset safe to bake into the client bundle.
   *
   * Nothing here is a secret: no bot token, no service account, no signing key.
   * `app.config.js` copies this into `expo.extra.attestation`, which is
   * readable by anyone who unpacks the APK.
   */
  public: {
    serverBaseUrl,
    attestationDebug,
    nonceTtlMs,
    maxAttestedLatencyMs,
    telegramBotUsername,
    webauthn: {
      rpId: webauthnRpId,
      rpName: webauthnRpName,
      origin: webauthnOrigin,
    },
  },
};

module.exports = AttestationConfig;
module.exports.AttestationConfig = AttestationConfig;
module.exports.default = AttestationConfig;
