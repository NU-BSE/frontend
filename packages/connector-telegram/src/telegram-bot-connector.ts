import * as z from 'zod/v4';
import {
  StoreBackedConnector,
  t,
  type ConnectionRecord,
  type ConnectorTool,
} from '@mobile-agent/connector-core';

const connectionId = z
  .string()
  .min(1)
  .describe('Id of the connected Telegram bot account to act on.');

/**
 * Telegram bot connector — separate from the personal-account connector on
 * purpose: auth modes, credentials, capabilities and lifecycle all differ,
 * and a bot must never be mistaken for the user.
 *
 * Still a mock: a real implementation needs a bot token kept in the
 * CredentialVault and HTTPS calls to the Bot API. Until then its tools are
 * marked `development_mock` and the production registry hides them.
 */
export class TelegramBotConnector extends StoreBackedConnector {
  readonly id = 'telegram-bot' as const;
  readonly displayName = 'Telegram Bot';
  readonly implementationStatus = 'mock' as const;

  async getTools(_connection: ConnectionRecord): Promise<ConnectorTool<any, any>[]> {
    return [
      t(
        'telegram.bot.get_me',
        'Bot identity',
        'Return the identity of the connected bot account. Read-only.',
        'read',
        z.object({ connectionId }),
        { id: 123, username: 'creepy_bot' },
      ),
      t(
        'telegram.bot.send_message',
        'Send message as bot',
        'Send a message to a chat as the bot. External side effect; requires approval.',
        'external_side_effect',
        z.object({
          connectionId,
          chatId: z.union([z.string(), z.number()]),
          text: z.string().min(1),
        }),
        { ok: true },
      ),
      t(
        'telegram.bot.edit_message',
        'Edit bot message',
        'Edit a message previously sent by the bot. External side effect; requires approval.',
        'external_side_effect',
        z.object({
          connectionId,
          chatId: z.union([z.string(), z.number()]),
          messageId: z.number(),
          text: z.string().min(1),
        }),
        { ok: true },
      ),
      t(
        'telegram.bot.delete_message',
        'Delete bot message',
        'Delete a message from a chat. Destructive; requires approval.',
        'destructive',
        z.object({
          connectionId,
          chatId: z.union([z.string(), z.number()]),
          messageId: z.number(),
        }),
        { ok: true },
      ),
      t(
        'telegram.bot.send_document',
        'Send document as bot',
        'Send a document to a chat as the bot. External side effect; requires approval.',
        'external_side_effect',
        z.object({
          connectionId,
          chatId: z.union([z.string(), z.number()]),
          document: z.string().min(1),
        }),
        { ok: true },
      ),
    ];
  }
}
