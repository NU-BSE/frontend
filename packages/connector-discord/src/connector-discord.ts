import * as z from 'zod/v4';
import type { ConnectionRecord, ConnectorTool } from '@mobile-agent/connector-core';
import { StoreBackedConnector, connId, opt, str, t } from '@mobile-agent/connector-core';

const tools: ConnectorTool[] = [
  t('discord.guilds.list', 'List guilds', 'List Discord servers', 'read',
    connId,
    [{ id: 'g1', name: 'My Server', owner: true }]),
  t('discord.channels.list', 'List channels', 'List channels in a guild', 'read',
    z.object({ connectionId: str, guildId: str }),
    [{ id: 'c1', name: 'general', type: 0 }]),
  t('discord.messages.list', 'List messages', 'List messages in a channel', 'read',
    z.object({ connectionId: str, channelId: str, limit: z.number().int().min(1).max(100).default(50) }),
    [{ id: 'm1', content: 'Hello world', author: { username: 'User' } }]),
  t('discord.messages.send', 'Send message', 'Send a message to a channel', 'external_side_effect',
    z.object({ connectionId: str, channelId: str, content: str }),
    { id: 'm2', content: 'Hello from the agent!' }),
  t('discord.messages.edit', 'Edit message', 'Edit a message', 'external_side_effect',
    z.object({ connectionId: str, channelId: str, messageId: str, content: str }),
    { id: 'm1', content: 'Edited message', edited: true }),
  t('discord.threads.create', 'Create thread', 'Create a thread from a message', 'external_side_effect',
    z.object({ connectionId: str, channelId: str, messageId: str, name: str }),
    { id: 'th1', name: 'Discussion thread' }),
];

export class DiscordConnector extends StoreBackedConnector {
  readonly id = 'discord' as const;
  readonly displayName = 'Discord';
  readonly implementationStatus = 'mock' as const;
  async getTools(_c: ConnectionRecord) { return tools; }
}
