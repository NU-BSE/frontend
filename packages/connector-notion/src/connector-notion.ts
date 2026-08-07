import * as z from 'zod/v4';
import type { Connector, ConnectionRecord, ConnectorTool } from '@mobile-agent/connector-core';
import { connId, mockConn, opt, str, t } from '@mobile-agent/connector-core';

const CONN = mockConn('notion', 'Notion');

const tools: ConnectorTool[] = [
  t('notion.search', 'Search', 'Search Notion', 'read',
    z.object({ connectionId: str, query: str }),
    { results: [{ id: 'n1', title: 'Meeting notes' }] }),
  t('notion.pages.get', 'Get page', 'Get a Notion page', 'read',
    connId,
    { id: 'n1', title: 'Meeting notes', content: '## Agenda\n- item 1' }),
  t('notion.pages.create', 'Create page', 'Create a Notion page', 'write',
    z.object({ connectionId: str, parentId: str, title: str, content: opt }),
    { id: 'n2', title: 'New page', url: 'https://notion.so/n2' }),
  t('notion.pages.update', 'Update page', 'Update a Notion page', 'write',
    z.object({ connectionId: str, pageId: str, title: opt, content: opt }),
    { id: 'n1', updated: true }),
  t('notion.dataSources.query', 'Query database', 'Query a Notion database', 'read',
    z.object({ connectionId: str, databaseId: str, filter: opt, sorts: opt }),
    { results: [{ id: 'r1', properties: { Name: { title: [{ plain_text: 'Task 1' }] } } }] }),
  t('notion.comments.create', 'Create comment', 'Add a comment to a page', 'external_side_effect',
    z.object({ connectionId: str, pageId: str, body: str }),
    { id: 'c1', created: true }),
];

export class NotionConnector implements Connector {
  readonly id = 'notion' as const;
  readonly displayName = 'Notion';
  async listConnections() { return [CONN]; }
  async getConnection(id: string) { return id === CONN.id ? CONN : null; }
  async getTools(_c: ConnectionRecord) { return tools; }
  async disconnect(_id: string) {}
}
