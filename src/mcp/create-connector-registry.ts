import type { ConnectionStore } from '@mobile-agent/connector-core';
import { ConnectorRegistry } from '@mobile-agent/connector-registry';
import type { CredentialVault } from '@mobile-agent/credential-vault';
import { AndroidConnector } from '@mobile-agent/connector-android';
import { GoogleConnector } from '@mobile-agent/connector-google';
import {
  MockTdlibAdapter,
  NativeTdlibAdapter,
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
import { resolveTelegramAdapterMode } from './telegram-adapter-mode';
import { getGoogleAuthorizationBridge } from '@/connections/google/native-bridge';
import { createGoogleFileSink } from '@/connections/google/file-sink';
import { getAndroidSettingsBridge } from '@/connections/android/settings-native-bridge';

export interface AppRegistryOptions {
  mode: McpRuntimeMode;
  connectionStore: ConnectionStore;
  credentialVault: CredentialVault;
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
 * the native AuthorizationClient bridge cannot load there. Without these the
 * connector still registers, and `connect()` reports that sign-in is
 * unavailable.
 */
function googleAuthOptions(
  connectionStore: ConnectionStore,
  credentialVault: CredentialVault,
) {
  return {
    store: connectionStore,
    vault: credentialVault,
    bridge: getGoogleAuthorizationBridge() ?? undefined,
    fileSink: createGoogleFileSink() ?? undefined,
    authorize: async () => {
      const { authorizeGoogle } = await import('@/connections/google/authorize');
      const { tokens, identity } = await authorizeGoogle();
      return {
        accessToken: tokens.accessToken,
        grantedScopes: tokens.grantedScopes,
        ...(identity.email ? { email: identity.email } : {}),
        ...(identity.name ? { name: identity.name } : {}),
        ...(identity.sub ? { externalAccountId: identity.sub } : {}),
      };
    },
  };
}

export function createConnectorRegistry(
  options: AppRegistryOptions,
): ConnectorRegistry {
  const { mode, connectionStore, credentialVault } = options;
  const development = mode === 'development';
  const store = { store: connectionStore };

  const registry = new ConnectorRegistry({
    allowDevelopmentMocks: development,
  });

  const telegramAdapterMode = resolveTelegramAdapterMode(mode);

  // The Android device connector only registers when the native Settings
  // bridge is actually available (Android + native module built in). On
  // web/iOS/Node it is omitted entirely — never a fake connector.
  const androidSettingsBridge = getAndroidSettingsBridge();

  const connectors = [
    ...(androidSettingsBridge
      ? [
          new AndroidConnector({
            store: connectionStore,
            settingsBridge: androidSettingsBridge,
          }),
        ]
      : []),
    new GoogleConnector(googleAuthOptions(connectionStore, credentialVault)),
    new TelegramUserConnector({
      store: connectionStore,
      vault: credentialVault,
      adapterFactory:
        telegramAdapterMode === 'mock'
          ? () => new MockTdlibAdapter()
          : () => new NativeTdlibAdapter(),
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
