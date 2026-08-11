import { ConnectorRegistry } from '@mobile-agent/connector-registry';
import type { ConnectionStore } from '@mobile-agent/connector-core';
import { AndroidConnector } from '@mobile-agent/connector-android';
import { GoogleConnector } from '@mobile-agent/connector-google';
import { TelegramConnector } from '@mobile-agent/connector-telegram';
import { MicrosoftConnector } from '@mobile-agent/connector-microsoft';
import { SlackConnector } from '@mobile-agent/connector-slack';
import { NotionConnector } from '@mobile-agent/connector-notion';
import { TodoistConnector } from '@mobile-agent/connector-todoist';
import { GithubConnector } from '@mobile-agent/connector-github';
import { DropboxConnector } from '@mobile-agent/connector-dropbox';
import { DiscordConnector } from '@mobile-agent/connector-discord';
import { SpotifyConnector } from '@mobile-agent/connector-spotify';
import { IntentConnector } from '@mobile-agent/connector-intents';

/**
 * Registers every connector, but tools only reach the agent for accounts the
 * `connections` store says are actually linked.
 */
export function createConnectorRegistry(
  connections: ConnectionStore,
): ConnectorRegistry {
  const registry = new ConnectorRegistry(connections);

  registry.register(new AndroidConnector());
  registry.register(new GoogleConnector());
  registry.register(new TelegramConnector());
  registry.register(new MicrosoftConnector());
  registry.register(new SlackConnector());
  registry.register(new NotionConnector());
  registry.register(new TodoistConnector());
  registry.register(new GithubConnector());
  registry.register(new DropboxConnector());
  registry.register(new DiscordConnector());
  registry.register(new SpotifyConnector());
  registry.register(new IntentConnector());

  return registry;
}

export { ConnectorRegistry };
