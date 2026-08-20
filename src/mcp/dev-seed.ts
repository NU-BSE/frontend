import type { ConnectionRecord, ConnectionStore } from '@mobile-agent/connector-core';
import { TELEGRAM_USER_SCOPES } from '@mobile-agent/connector-telegram';

/**
 * Development-mode account seeding. Local device connectors (Android Settings
 * and Android Intents) are never mocked or seeded; the runtime connects them
 * only when their real native bridges are present.
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

/** Include the retired mock intent id so upgrades clean it up once. */
const CLEANUP_IDS = new Set([
  ...DEV_CONNECTIONS.map((connection) => connection.id),
  'intent-default',
]);

/**
 * Removes known development-seed connections from the store. Safe in
 * production because only fixed fixture ids are removed.
 */
export async function removeDevelopmentConnections(
  store: ConnectionStore,
): Promise<void> {
  for (const id of CLEANUP_IDS) {
    await store.remove(id);
  }
}
