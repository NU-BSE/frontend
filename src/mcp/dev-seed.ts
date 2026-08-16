import type { ConnectionRecord, ConnectionStore } from '@mobile-agent/connector-core';

/**
 * The one connection that exists without anyone signing in, plus cleanup of
 * the ones that used to.
 *
 * Development mode previously pre-connected thirteen labelled mock accounts so
 * the agent loop was demoable without credentials. The cost was that every
 * service read "Connected" on a fresh install while none of them were, which
 * is a claim the app should never make about someone's accounts — and a user
 * could "disconnect" an account they had never connected.
 *
 * Now only the device itself is connected, in every mode. It is not a mock and
 * not an account: the Android connector reads local data through OS
 * permissions, so there is no credential to obtain and nothing to sign into.
 * Everything else appears only through a real auth flow.
 */
function devConnection(
  id: string,
  connectorId: ConnectionRecord['connectorId'],
  displayName: string,
  extra?: Partial<ConnectionRecord>,
): ConnectionRecord {
  const now = Date.now();
  return {
    id,
    connectorId,
    displayName,
    status: 'connected',
    scopes: [],
    capabilities: [`${connectorId}.read`, `${connectorId}.write`],
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

/** The device connector's id, exported so the UI can refuse to disconnect it. */
export const DEVICE_CONNECTION_ID = 'android-device';

const DEVICE_CONNECTION: ConnectionRecord = devConnection(
  DEVICE_CONNECTION_ID,
  'android',
  'This device',
  {
    capabilities: [
      'android.contacts.read',
      'android.calendar.read',
      'android.files.read',
      'android.notifications.read',
      'android.location.read',
      'android.clipboard.read',
      'android.apps.read',
      'android.media.control',
    ],
  },
);

/**
 * Ensures the device connection exists, in every mode.
 *
 * Never overwrites an existing record: the store is the source of truth once
 * something is there, and clobbering it on every launch would discard whatever
 * the connector had recorded about the device.
 */
export async function ensureDeviceConnection(store: ConnectionStore): Promise<void> {
  const existing = await store.get(DEVICE_CONNECTION.id);
  if (!existing) {
    await store.save(DEVICE_CONNECTION);
    return;
  }

  /*
   * One exception to not overwriting: the label. Installs that ran an older
   * build have this record saved as "This device (development mock)", and it
   * is neither development-only nor a mock any more. Leaving it would print
   * "development mock" under Settings in a release build.
   */
  if (existing.displayName !== DEVICE_CONNECTION.displayName) {
    await store.save({ ...existing, displayName: DEVICE_CONNECTION.displayName });
  }
}

/**
 * Ids the old development seed used to write.
 *
 * Kept only so those records can be deleted. Existing installs have them
 * persisted and would otherwise keep showing twelve services as connected
 * forever — removing the seeding code alone does not remove what it already
 * wrote. Fixed ids, so a real connection can never be caught by this.
 */
const LEGACY_SEED_IDS = [
  'google-default',
  'telegram-bot-default',
  'telegram-user-default',
  'microsoft-default',
  'slack-default',
  'notion-default',
  'todoist-default',
  'github-default',
  'dropbox-default',
  'discord-default',
  'spotify-default',
  'intent-default',
];

/**
 * Removes the connections the old development seed created.
 *
 * Runs in every mode, unlike the seeding it undoes: a user who ran a
 * development build once has these rows on disk, and they are just as wrong in
 * a production build.
 */
export async function removeDevelopmentConnections(
  store: ConnectionStore,
): Promise<void> {
  for (const id of LEGACY_SEED_IDS) {
    await store.remove(id);
  }
}
