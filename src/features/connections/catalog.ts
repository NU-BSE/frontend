import type { ConnectorId } from '@mobile-agent/connector-core';

/**
 * The connector catalogue shown on "Connect your services" and Account →
 * Connectors.
 *
 * Mirrors section 1 of IMPLEMENT_ALL_CONNECTORS.md, so the screen is a
 * complete picture of what the agent can reach. It replaces AUTH_PROVIDERS,
 * which listed four sign-in providers while thirteen connectors were actually
 * registered — most of the surface was invisible.
 *
 * `connectorId` is the id the connector registers under, so a tile maps
 * straight onto a ConnectionRecord. Planned entries have none: nothing is
 * registered for them yet, and a tile that cannot resolve to a connector must
 * not offer to connect.
 *
 * Deliberately excluded: the spec's "VLM/UI automation fallback", which it
 * marks research/internal-only.
 */
export interface ConnectorCatalogEntry {
  key: string;
  label: string;
  /** The concrete capability, not marketing copy. */
  summary: string;
  connectorId?: ConnectorId;
  /** Shown instead of the summary when there is nothing to connect to. */
  note?: string;
}

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  { key: 'android', label: 'This device', summary: 'System settings and device controls', connectorId: 'android' },
  { key: 'google', label: 'Google', summary: 'Calendar, Gmail, Drive', connectorId: 'google' },
  { key: 'telegram-user', label: 'Telegram', summary: 'Personal account', connectorId: 'telegram-user' },
  { key: 'telegram-bot', label: 'Telegram Bot', summary: 'Bot API messaging', connectorId: 'telegram-bot' },
  { key: 'microsoft', label: 'Microsoft', summary: 'Outlook, OneDrive, To Do', connectorId: 'microsoft' },
  { key: 'slack', label: 'Slack', summary: 'Channels and messages', connectorId: 'slack' },
  { key: 'notion', label: 'Notion', summary: 'Pages and databases', connectorId: 'notion' },
  { key: 'todoist', label: 'Todoist', summary: 'Projects and tasks', connectorId: 'todoist' },
  { key: 'github', label: 'GitHub', summary: 'Repos, issues, actions', connectorId: 'github' },
  { key: 'dropbox', label: 'Dropbox', summary: 'Files and sharing', connectorId: 'dropbox' },
  { key: 'discord', label: 'Discord', summary: 'Guilds and channels', connectorId: 'discord' },
  { key: 'spotify', label: 'Spotify', summary: 'Search and playback', connectorId: 'spotify' },
  { key: 'intent', label: 'App intents', summary: 'Open apps and links', connectorId: 'intent' },
  { key: 'whatsapp', label: 'WhatsApp', summary: 'Share and deep links', note: 'Coming soon' },
];
