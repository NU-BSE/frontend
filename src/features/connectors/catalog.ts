/**
 * The connector catalogue shown on the "Connect your services" screen.
 *
 * Mirrors section 1 of IMPLEMENT_ALL_CONNECTORS.md — every connector named
 * there appears here, so the screen is a complete picture of what the agent
 * can reach rather than the four OAuth providers it used to list.
 *
 * `status` distinguishes what exists today from what the spec plans:
 * `available` means a connector package is registered with the MCP server and
 * its tools are already published to the agent. Keeping the planned entries
 * visible but disabled is deliberate — an empty slot invites the question
 * "is this coming?", and a greyed tile answers it.
 *
 * Deliberately excluded: the spec's "VLM/UI automation fallback", which it
 * marks research/internal-only and which should not be offered to users.
 */

export type ConnectorStatus = 'available' | 'planned';

export interface ConnectorEntry {
  id: string;
  label: string;
  /** What the tile says under the name — the concrete capability, not marketing. */
  summary: string;
  status: ConnectorStatus;
}

export const CONNECTOR_CATALOG: ConnectorEntry[] = [
  { id: 'android', label: 'This device', summary: 'Contacts, calendar, files', status: 'available' },
  { id: 'google', label: 'Google', summary: 'Calendar, Gmail, Drive', status: 'available' },
  { id: 'telegram-bot', label: 'Telegram Bot', summary: 'Bot API messaging', status: 'available' },
  { id: 'telegram-user', label: 'Telegram', summary: 'Personal account', status: 'available' },
  { id: 'microsoft', label: 'Microsoft', summary: 'Outlook, OneDrive, To Do', status: 'available' },
  { id: 'slack', label: 'Slack', summary: 'Channels and messages', status: 'available' },
  { id: 'notion', label: 'Notion', summary: 'Pages and databases', status: 'available' },
  { id: 'todoist', label: 'Todoist', summary: 'Projects and tasks', status: 'available' },
  { id: 'github', label: 'GitHub', summary: 'Repos, issues, actions', status: 'available' },
  { id: 'dropbox', label: 'Dropbox', summary: 'Files and sharing', status: 'available' },
  { id: 'discord', label: 'Discord', summary: 'Guilds and channels', status: 'available' },
  { id: 'spotify', label: 'Spotify', summary: 'Search and playback', status: 'available' },
  { id: 'intents', label: 'App intents', summary: 'Open apps and links', status: 'available' },
  { id: 'whatsapp', label: 'WhatsApp', summary: 'Share and deep links', status: 'planned' },
];

export const isConnectable = (entry: ConnectorEntry): boolean =>
  entry.status === 'available';
