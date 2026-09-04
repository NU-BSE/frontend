import type { ConnectionStore } from '@mobile-agent/connector-core';
import { ConnectorRegistry } from '@mobile-agent/connector-registry';
import type { CredentialVault } from '@mobile-agent/credential-vault';
import { AndroidConnector } from '@mobile-agent/connector-android';
import { GoogleConnector } from '@mobile-agent/connector-google';
import {
  MockTdlibAdapter,
  NativeTdlibAdapter,
  TelegramUserConnector,
} from '@mobile-agent/connector-telegram';
import { IntentConnector } from '@mobile-agent/connector-intents';

import type { McpRuntimeMode } from './runtime-mode';
import { resolveTelegramAdapterMode } from './telegram-adapter-mode';
import { getGoogleAuthorizationBridge } from '@/connections/google/native-bridge';
import { createGoogleFileSink } from '@/connections/google/file-sink';
import { getAndroidAssistantBridge } from '@/connections/android/assistant-native-bridge';
import { getDeviceSignalBridge } from '@/connections/android/device-signal-bridge';
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
 * RELEASE BUILD: four connectors, all of which reach something real.
 *
 * `main` also constructs Microsoft, Slack, Notion, Todoist, GitHub, Dropbox,
 * Discord, Spotify and the Telegram *bot* connector. Every one of those
 * reports `implementationStatus: 'mock'`: they answer from fixtures. The
 * `!development` guard below kept them out of a production bundle, but a
 * development build is what runs on a phone during a demo, and there they were
 * not merely useless — they were expensive. The registry hands the planner
 * every registered connector's tools, so the mocks contributed most of a
 * 103-tool, ~7,000-token prompt that a local 2B with a 4,096-token window
 * cannot even load; llama.cpp refuses it outright with "Context is full".
 * `toolsForConnections` in AgentRuntime already drops tools for accounts that
 * are not connected, but nothing stops a curious user from "connecting" a mock
 * and getting invented answers.
 *
 * So on this branch they are gone in both modes, matching
 * `features/connections/catalog.ts`, which was cut to the same set and for the
 * same reason. The packages themselves are untouched under `packages/` and the
 * removed lines are intact on `main`; restoring an entry is a copy back.
 *
 * The `!development` guard stays: it is what stops a restored mock from
 * reaching a release by accident.
 *
 * Local Android Settings/Intent connectors register only when their native
 * bridge is actually present, so no fixture success can leak into a production
 * build.
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

  const registry = new ConnectorRegistry({
    allowDevelopmentMocks: development,
  });

  const telegramAdapterMode = resolveTelegramAdapterMode(mode);
  const androidSettingsBridge = getAndroidSettingsBridge();
  // Independent of the settings bridge: a build can carry one native module
  // and not the other, so the assistant tools are gated on their own.
  const androidAssistantBridge = getAndroidAssistantBridge();
  const androidSignalBridge = getDeviceSignalBridge();
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
            ...(androidSignalBridge ? { signalBridge: androidSignalBridge } : {}),
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
  ];

  for (const connector of connectors) {
    if (!development && connector.implementationStatus === 'mock') continue;
    registry.register(connector);
  }

  return registry;
}

export { ConnectorRegistry };
