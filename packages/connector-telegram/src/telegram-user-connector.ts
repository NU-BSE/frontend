import * as z from 'zod/v4';
import {
  ConnectorError,
  StoreBackedConnector,
  type ConnectionRecord,
  type ConnectorTool,
  type ConnectionStore,
  type ToolExecutionContext,
} from '@mobile-agent/connector-core';

import { MockTdlibAdapter } from './tdlib/mock-adapter';
import { NativeTdlibAdapter } from './tdlib/bridge';
import type { TdlibAdapter } from './tdlib/types';

export const TELEGRAM_USER_SCOPES = [
  'telegram.chats.read',
  'telegram.messages.read',
  'telegram.messages.send',
] as const;

export interface TelegramUserConnectorOptions {
  store: ConnectionStore;
  /**
   * Tests and development builds inject the mock adapter. The default is the
   * native TDLib bridge, which honestly reports unavailability until the
   * Phase D native module ships.
   */
  adapterFactory?: () => TdlibAdapter;
}

const connectionIdField = z
  .string()
  .min(1)
  .describe('Id of the connected Telegram account to act on.');

/**
 * Chat ids come back from `search_chats` as strings, but models (and the
 * schema regression tests) may emit numbers; both are accepted and
 * normalised to the string form TDLib uses.
 */
const chatIdField = z
  .union([z.string().min(1), z.number()])
  .describe('Chat id returned by telegram.user.search_chats.');

/**
 * Telegram on behalf of the authenticated *user* (not a bot), through TDLib.
 *
 * Connection records live in the shared ConnectionStore; the TDLib session
 * itself lives on the native side and is referenced only by
 * `credentialReference` — session material never enters this layer, the
 * model context, or logs.
 */
export class TelegramUserConnector extends StoreBackedConnector {
  readonly id = 'telegram-user' as const;
  readonly displayName = 'Telegram (personal account)';

  private readonly adapter: TdlibAdapter;

  constructor(options: TelegramUserConnectorOptions) {
    super({ store: options.store });
    this.adapter = (options.adapterFactory ?? (() => new NativeTdlibAdapter()))();
  }

  /**
   * Honesty follows the adapter: with the mock adapter this connector is a
   * development mock; with the native TDLib bridge it is production.
   */
  get implementationStatus(): 'mock' | 'production' {
    return this.adapter.kind === 'mock' ? 'mock' : 'production';
  }

  /** Exposed for the Phase D auth state-machine UI. */
  getAdapter(): TdlibAdapter {
    return this.adapter;
  }

  /**
   * Tools re-attach to an existing session lazily. Connector instances are
   * recreated whenever the MCP runtime restarts (e.g. after a connect or
   * disconnect), but the session itself lives on: in TDLib's encrypted
   * database on the native side, or as the mock's instant dev session.
   */
  private async ensureSession(): Promise<void> {
    if (this.adapter.getAuthState().type === 'ready') return;

    if (this.adapter instanceof MockTdlibAdapter) {
      await this.adapter.initialize();
      this.adapter.restoreDevSession();
      return;
    }

    await this.adapter.initialize();
    const state = this.adapter.getAuthState();
    if (state.type !== 'ready') {
      throw new ConnectorError(
        'Telegram authorization is no longer active. Reconnect Telegram.',
        'AUTH_REQUIRED',
      );
    }
  }

  /**
   * Creates a connected account record after the adapter reaches `ready`.
   *
   * With the mock adapter this is instant (development preview). With the
   * native adapter the interactive phone/code/2FA state machine drives the
   * adapter from the auth screen; calling this before that flow completes is
   * an error, never a silent fake connection.
   */
  async connect(): Promise<ConnectionRecord> {
    if (this.adapter instanceof MockTdlibAdapter) {
      await this.adapter.initialize();
      this.adapter.restoreDevSession();
    } else {
      await this.adapter.initialize();
      const state = this.adapter.getAuthState();
      if (state.type !== 'ready') {
        throw new ConnectorError(
          'Telegram sign-in is interactive (phone number, code, optional 2FA ' +
            'password) and must run through the Telegram auth screen. ' +
            `Current TDLib state: ${state.type}.`,
          'AUTH_REQUIRED',
        );
      }
    }

    const state = this.adapter.getAuthState();
    if (state.type !== 'ready') {
      throw new ConnectorError(
        `Telegram session is not ready (state: ${state.type})`,
        'AUTH_REQUIRED',
      );
    }

    const user = state.user;
    const now = Date.now();
    const record: ConnectionRecord = {
      id: `telegram-user:${user.id}`,
      connectorId: 'telegram-user',
      externalAccountId: user.id,
      displayName:
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        user.username ||
        `Telegram user ${user.id}`,
      status: 'connected',
      scopes: [...TELEGRAM_USER_SCOPES],
      capabilities: [...TELEGRAM_USER_SCOPES],
      credentialReference: `tdlib-session:${user.id}`,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.save(record);
    return record;
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = await this.getConnection(connectionId);
    if (!connection) return;

    try {
      await this.adapter.logOut();
    } catch {
      // Provider-side logout is best-effort; the local record must still go.
    }
    await super.disconnect(connectionId);
  }

  async getTools(_connection: ConnectionRecord): Promise<ConnectorTool<any, any>[]> {
    const adapter = this.adapter;
    const status =
      this.adapter.kind === 'mock' ? 'development_mock' : ('real' as const);

    const searchChats: ConnectorTool = {
      name: 'telegram.user.search_chats',
      title: 'Search Telegram chats',
      description:
        "Search the connected user's personal Telegram chats, groups and " +
        'channels by name or username. Use this first whenever the user ' +
        'refers to a person or chat by name and you do not have a chat id ' +
        'yet. Returns a bounded list of chats with stable ids. Read-only; ' +
        'requires no approval.',
      inputSchema: z.object({
        connectionId: connectionIdField,
        query: z
          .string()
          .min(1)
          .describe("Name or username to search for, e.g. a person's name."),
      }),
      risk: 'read',
      capabilities: ['telegram.chats.read'],
      requiredScopes: ['telegram.chats.read'],
      implementationStatus: status,
      execute: async (input: { query: string }) => {
        await this.ensureSession();
        const chats = await adapter.searchChats(input.query, 10);
        return { chats };
      },
    };

    const getRecentMessages: ConnectorTool = {
      name: 'telegram.user.get_recent_messages',
      title: 'Read recent Telegram messages',
      description:
        'Read the most recent messages of one Telegram chat. Requires a chat ' +
        'id obtained from telegram.user.search_chats — never guess chat ids. ' +
        'Returns at most `limit` latest messages; the result is bounded on ' +
        'purpose, do not attempt to export full history. Read-only; requires ' +
        'no approval.',
      inputSchema: z.object({
        connectionId: connectionIdField,
        chatId: chatIdField,
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe('Maximum number of messages to return (1-50).'),
      }),
      risk: 'read',
      capabilities: ['telegram.messages.read'],
      requiredScopes: ['telegram.messages.read'],
      implementationStatus: status,
      execute: async (input: { chatId: string | number; limit?: number }) => {
        await this.ensureSession();
        const chatId = String(input.chatId);
        const messages = await adapter.getRecentMessages(
          chatId,
          input.limit ?? 20,
        );
        return { chatId, messages };
      },
    };

    const sendMessage: ConnectorTool = {
      name: 'telegram.user.send_message',
      title: 'Send Telegram message',
      description:
        "Send a Telegram text message from the connected user's personal " +
        'Telegram account. Use telegram.user.search_chats first when only a ' +
        "person's name is known, then pass the chat id from its result. " +
        'Causes an external side effect and ALWAYS requires explicit user ' +
        'approval: the first call returns status "approval_required", and ' +
        'the message is sent only after the user confirms. Do not claim the ' +
        'message was sent unless a call returns status "success".',
      inputSchema: z.object({
        connectionId: connectionIdField,
        chatId: chatIdField,
        chatTitle: z
          .string()
          .optional()
          .describe(
            'Human-readable chat title shown on the confirmation screen. ' +
              'Display-only; sending always uses chatId.',
          ),
        text: z
          .string()
          .min(1)
          .max(4096)
          .describe('Message text exactly as the user wants it sent.'),
      }),
      risk: 'external_side_effect',
      capabilities: ['telegram.messages.send'],
      requiredScopes: ['telegram.messages.send'],
      implementationStatus: status,
      execute: async (
        input: { chatId: string | number; text: string },
        _context: ToolExecutionContext,
      ) => {
        await this.ensureSession();
        const sent = await adapter.sendMessage(String(input.chatId), input.text);
        return {
          status: 'sent',
          messageId: sent.messageId,
          chatId: sent.chatId,
          sentAt: sent.sentAt,
        };
      },
    };

    return [searchChats, getRecentMessages, sendMessage];
  }
}
