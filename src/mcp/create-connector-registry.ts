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
import { getAndroidAssistantBridge } from '@/connections/android/assistant-native-bridge';
import { getAndroidSettingsBridge } from '@/connections/android/settings-native-bridge';
import { getAndroidIntentBridge } from '@/connections/android/intent-native-bridge';

export interface AppRegistryOptions {
  mode: McpRuntimeMode;
  connectionStore: ConnectionStore;
  credentialVault: CredentialVault;
}

/**
 * Registry factory with explicit dependencies: connector packages stay
 * platform-neutral and native app bridges are injected here.
 *
 * Development may register mock connectors; production rejects mocks. Local
 * Android Settings/Intent connectors register only when their native bridge is
 * actually present, so no fixture success can leak into a production build.
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
  const androidSettingsBridge = getAndroidSettingsBridge();
  // Independent of the settings bridge: a build can carry one native module
  // and not the other, so the assistant tools are gated on their own.
  const androidAssistantBridge = getAndroidAssistantBridge();
  const androidIntentBridge = getAndroidIntentBridge();

  const connectors = [
    ...(androidSettingsBridge
      ? [
          new AndroidConnector({
            store: connectionStore,
            settingsBridge: androidSettingsBridge,
            ...(androidAssistantBridge
              ? { assistantBridge: androidAssistantBridge }
              : {}),
          }),
        ]
      : []),
    ...(androidIntentBridge
      ? [
          new IntentConnector({
            store: connectionStore,
            bridge: androidIntentBridge,
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
  ];

  for (const connector of connectors) {
    if (!development && connector.implementationStatus === 'mock') continue;
    registry.register(connector);
  }

  return registry;
}

export { ConnectorRegistry };
