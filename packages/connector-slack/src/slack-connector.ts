import * as z from 'zod/v4';
import type { Connector, ConnectionRecord, ConnectorTool } from '@mobile-agent/connector-core';
import { connId, mockConn, opt, str, t } from '@mobile-agent/connector-core';

const CONN = mockConn('slack', 'Slack');

const conversations = [
  t('slack.conversations.list', 'List conversations', 'List Slack channels and DMs', 'read',
    z.object({ connectionId: str }),
    { channels: [{ id: 'C01', name: 'general', is_channel: true, num_members: 42 }] }),
  t('slack.conversations.history', 'Get history', 'Get messages from a conversation', 'read',
    z.object({ connectionId: str, channelId: str, limit: z.number().int().min(1).max(100).default(20) }),
    { messages: [{ ts: '1723000000.000001', user: 'U01', text: 'Hello!' }] }),
];

const messages = [
  t('slack.messages.search', 'Search messages', 'Search messages across Slack', 'read',
    z.object({ connectionId: str, query: str }),
    { messages: [{ ts: '1723000000.000001', channel: { id: 'C01', name: 'general' }, user: 'U01', text: 'Hello!' }] }),
  t('slack.messages.get_thread', 'Get thread', 'Get a message thread', 'read',
    z.object({ connectionId: str, channelId: str, threadTs: str }),
    { messages: [{ ts: '1723000000.000001', user: 'U01', text: 'Hello!' }, { ts: '1723000000.000002', user: 'U02', text: 'Re: Hello!' }] }),
  t('slack.messages.send', 'Send message', 'Send a message to a conversation', 'external_side_effect',
    z.object({ connectionId: str, channelId: str, text: str }),
    { ts: '1723000000.000003', channel: 'C01' }),
  t('slack.messages.update', 'Update message', 'Update an existing message', 'external_side_effect',
    z.object({ connectionId: str, channelId: str, ts: str, text: str }),
    { ts: '1723000000.000001', channel: 'C01', updated: true }),
];

const reactions = [
  t('slack.reactions.add', 'Add reaction', 'Add a reaction to a message', 'external_side_effect',
    z.object({ connectionId: str, channelId: str, timestamp: str, name: str }),
    { ok: true }),
];

export class SlackConnector implements Connector {
  readonly id = 'slack' as const;
  readonly displayName = 'Slack';
  async listConnections() { return [CONN]; }
  async getConnection(id: string) { return id === CONN.id ? CONN : null; }
  async getTools(_c: ConnectionRecord) {
    return [...conversations, ...messages, ...reactions];
  }
  async disconnect(_id: string) {}
}
