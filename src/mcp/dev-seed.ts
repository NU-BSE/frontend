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

const DEV_CONNECTIONS: ConnectionRecord[] = [
  devConnection('android-device', 'android', 'This device', {
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
  }),
  devConnection('google-default', 'google', 'Google Account'),
  devConnection('telegram-bot-default', 'telegram-bot', 'Telegram Bot'),
  devConnection('telegram-user-default', 'telegram-user', 'Telegram User', {
    scopes: [...TELEGRAM_USER_SCOPES],
    capabilities: [...TELEGRAM_USER_SCOPES],
    credentialReference: 'tdlib-session:dev',
  }),
  devConnection('microsoft-default', 'microsoft', 'Microsoft Account'),
  devConnection('slack-default', 'slack', 'Slack'),
  devConnection('notion-default', 'notion', 'Notion'),
  devConnection('todoist-default', 'todoist', 'Todoist'),
  devConnection('github-default', 'github', 'GitHub'),
  devConnection('dropbox-default', 'dropbox', 'Dropbox'),
  devConnection('discord-default', 'discord', 'Discord'),
  devConnection('spotify-default', 'spotify', 'Spotify'),
  devConnection('intent-default', 'intent', 'Android Intents'),
];

export interface SeedOptions {
  /** When true, skip seeding the mock Telegram connection. */
  skipTelegramSeed?: boolean;
}

export async function seedDevelopmentConnections(
  store: ConnectionStore,
  options: SeedOptions = {},
): Promise<void> {
  for (const connection of DEV_CONNECTIONS) {
    if (options.skipTelegramSeed && connection.connectorId === 'telegram-user') continue;
    const existing = await store.get(connection.id);
    if (existing) continue;
    await store.save(connection);
  }
}

const CLEANUP_IDS = new Set(DEV_CONNECTIONS.map((c) => c.id));

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
