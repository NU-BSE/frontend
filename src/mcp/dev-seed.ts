import type { ConnectionRecord, ConnectionStore } from '@mobile-agent/connector-core';
import { TELEGRAM_USER_SCOPES } from '@mobile-agent/connector-telegram';

/**
 * Development-mode seeding.
 *
 * In `development` mode the runtime pre-connects clearly labeled mock
 * accounts so the agent loop is demoable end-to-end without real provider
 * credentials (the same affordance the app had before the connection model
 * became real). In `production` this function is never called: connections
 * only appear through real auth flows.
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
    displayName: `${displayName} (development mock)`,
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

export async function seedDevelopmentConnections(
  store: ConnectionStore,
): Promise<void> {
  for (const connection of DEV_CONNECTIONS) {
    const existing = await store.get(connection.id);
    if (existing) continue;
    await store.save(connection);
  }
}

const CLEANUP_IDS = new Set(DEV_CONNECTIONS.map((c) => c.id));

/**
 * Removes known development-seed connections from the store.
 * Safe to call in production — only removes the well-known fixed IDs,
 * never touches real user connections.
 */
export async function removeDevelopmentConnections(
  store: ConnectionStore,
): Promise<void> {
  for (const id of CLEANUP_IDS) {
    await store.remove(id);
  }
}
