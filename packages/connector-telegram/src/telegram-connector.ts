import * as z from 'zod/v4';
import { mockConn, str, t } from '@mobile-agent/connector-core';
import type { Connector, ConnectionRecord, ConnectorTool } from '@mobile-agent/connector-core';

const botConn = mockConn('telegram-bot', 'Telegram Bot');
const userConn = mockConn('telegram-user', 'Telegram User');

const chatId = z.union([str, z.number()]);

const botTools: ConnectorTool[] = [
  t('telegram.bot.get_me', 'Get Bot Info', 'Returns the bot identity', 'read', z.object({}), {
    id: 123,
    username: 'creepy_bot',
  }),
  t(
    'telegram.bot.send_message',
    'Send Message',
    'Send a text message via the bot',
    'external_side_effect',
    z.object({ connectionId: str, chatId, text: str }),
    { ok: true },
  ),
  t(
    'telegram.bot.edit_message',
    'Edit Message',
    'Edit a previously sent message',
    'external_side_effect',
    z.object({ connectionId: str, chatId, messageId: z.number(), text: str }),
    { ok: true },
  ),
  t(
    'telegram.bot.delete_message',
    'Delete Message',
    'Delete a message sent by the bot',
    'external_side_effect',
    z.object({ connectionId: str, chatId, messageId: z.number() }),
    { ok: true },
  ),
  t(
    'telegram.bot.send_document',
    'Send Document',
    'Send a document via the bot',
    'external_side_effect',
    z.object({ connectionId: str, chatId, document: str }),
    { ok: true },
  ),
];

const userTools: ConnectorTool[] = [
  t(
    'telegram.user.search_chats',
    'Search Chats',
    'Search user chats and contacts',
    'read',
    z.object({ connectionId: str, query: str }),
    [],
  ),
  t(
    'telegram.user.get_recent_messages',
    'Get Recent Messages',
    'Retrieve recent messages from a chat',
    'read',
    z.object({ connectionId: str, chatId, limit: z.number().optional().default(20) }),
    [],
  ),
  t(
    'telegram.user.send_message',
    'Send Message',
    'Send a text message as the user',
    'external_side_effect',
    z.object({ connectionId: str, chatId, text: str }),
    { ok: true },
  ),
];

export class TelegramConnector implements Connector {
  readonly id = 'telegram-bot' as const;
  readonly displayName = 'Telegram';
  /** One connector, two account kinds: the Bot API and a personal TDLib session. */
  readonly ownedConnectorIds = ['telegram-bot', 'telegram-user'] as const;

  async listConnections(): Promise<ConnectionRecord[]> {
    return [botConn, userConn];
  }

  async getConnection(connectionId: string): Promise<ConnectionRecord | null> {
    return [botConn, userConn].find((c) => c.id === connectionId) ?? null;
  }

  async getTools(connection: ConnectionRecord): Promise<ConnectorTool[]> {
    return connection.connectorId === 'telegram-bot' ? botTools : userTools;
  }

  async disconnect(_connectionId: string): Promise<void> {}
}
