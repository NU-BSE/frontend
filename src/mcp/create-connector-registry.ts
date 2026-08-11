import type { ConnectionStore } from '@mobile-agent/connector-core';
import { ConnectorRegistry } from '@mobile-agent/connector-registry';
import { getCredentialVault } from '@/mcp/runtime-singleton';
import { AndroidConnector } from '@mobile-agent/connector-android';
import { GoogleConnector } from '@mobile-agent/connector-google';
import {
  MockTdlibAdapter,
  TelegramBotConnector,
  TelegramUserConnector,
} from '@mobile-agent/connector-telegram';
import { MicrosoftConnector } from '@mobile-agent/connector-microsoft';
import { SlackConnector } from '@mobile-agent/connector-slack';
import { NotionConnector } from '@mobile-agent/connector-notion';
import { TodoistConnector } from '@mobile-agent/connector-todoist';
import { GithubConnector } from '@mobile-agent/connector-github';
import { DropboxConnector } from '@mobile-agent/connector-dropbox';
import { DiscordConnector } from '@mobile-agent/connector-discord';
import { SpotifyConnector } from '@mobile-agent/connector-spotify';
import { IntentConnector } from '@mobile-agent/connector-intents';

import type { McpRuntimeMode } from './runtime-mode';

export interface AppRegistryOptions {
  mode: McpRuntimeMode;
  connectionStore: ConnectionStore;
}

/**
 * The registry factory with explicit dependencies (section 33 of
 * FINISH_FRONTEND_AGENT.md): no connector constructor secretly creates its
 * own in-memory store — every connector reads the shared ConnectionStore.
 *
 * Mode rules:
 * - `development`: mock connectors may register and expose dev tools.
 * - `production`: connectors whose `implementationStatus` is `mock` are not
 *   registered at all, so the model can never see tools that would report
 *   fake success. Telegram's personal connector registers when it runs on
 *   the native TDLib adapter (status follows the adapter).
 */
/**
 * Google's real sign-in, injected here rather than imported by the connector
 * package: the package is bundled for Node by the verification scripts, and
 * `expo-auth-session` cannot load there. Without these the connector still
 * registers, and `connect()` reports that sign-in is unavailable.
 */
function googleAuthOptions(connectionStore: ConnectionStore) {
  return {
    store: connectionStore,
    vault: getCredentialVault(),
    authorize: async () => {
      const { authorizeGoogle } = await import('@/connections/google/authorize');
      const { tokens, identity } = await authorizeGoogle();
      return {
        ...tokens,
        ...(identity.email ? { email: identity.email } : {}),
        ...(identity.name ? { name: identity.name } : {}),
      };
    },
    revoke: async (token: string) => {
      const { revokeGoogleToken } = await import('@/connections/google/authorize');
      await revokeGoogleToken(token);
    },
  };
}

export function createConnectorRegistry(
  options: AppRegistryOptions,
): ConnectorRegistry {
  const { mode, connectionStore } = options;
  const development = mode === 'development';
  const store = { store: connectionStore };

  const registry = new ConnectorRegistry({
    allowDevelopmentMocks: development,
  });

  const connectors = [
    new AndroidConnector(store),
    new GoogleConnector(googleAuthOptions(connectionStore)),
    new TelegramUserConnector({
      store: connectionStore,
      adapterFactory: development ? () => new MockTdlibAdapter() : undefined,
    }),
    new TelegramBotConnector(store),
    new MicrosoftConnector(store),
    new SlackConnector(store),
    new NotionConnector(store),
    new TodoistConnector(store),
    new GithubConnector(store),
    new DropboxConnector(store),
    new DiscordConnector(store),
    new SpotifyConnector(store),
    new IntentConnector(store),
  ];

  for (const connector of connectors) {
    if (!development && connector.implementationStatus === 'mock') continue;
    registry.register(connector);
  }

  return registry;
}

export { ConnectorRegistry };
