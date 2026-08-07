import * as z from 'zod/v4';
import type { Connector, ConnectionRecord, ConnectorTool } from '@mobile-agent/connector-core';
import { connId, mockConn, opt, str, t } from '@mobile-agent/connector-core';

const CONN = mockConn('intent', 'Android Intents');

const tools: ConnectorTool[] = [
  t('intent.open_uri', 'Open URI', 'Open a URI in an external app', 'write',
    z.object({ connectionId: str, uri: str }),
    { success: true }),
  t('intent.open_app', 'Open app', 'Open an installed app', 'write',
    z.object({ connectionId: str, packageName: str }),
    { success: true }),
  t('intent.share_text', 'Share text', 'Share text via the share sheet', 'external_side_effect',
    z.object({ connectionId: str, text: str, targetPackage: opt }),
    { success: true }),
  t('intent.share_file', 'Share file', 'Share a file via the share sheet', 'external_side_effect',
    z.object({ connectionId: str, fileUri: str, mimeType: opt, targetPackage: opt }),
    { success: true }),
  t('intent.compose_email', 'Compose email', 'Open email composer', 'external_side_effect',
    z.object({ connectionId: str, to: opt, subject: opt, body: opt }),
    { success: true }),
  t('intent.open_map', 'Open map', 'Open map app at location', 'write',
    z.object({ connectionId: str, query: opt, latitude: z.number().optional(), longitude: z.number().optional() }),
    { success: true }),
  t('intent.open_dialer', 'Open dialer', 'Open phone dialer', 'write',
    z.object({ connectionId: str, phoneNumber: opt }),
    { success: true }),
];

export class IntentConnector implements Connector {
  readonly id = 'intent' as const;
  readonly displayName = 'Android Intents';
  async listConnections() { return [CONN]; }
  async getConnection(id: string) { return id === CONN.id ? CONN : null; }
  async getTools(_c: ConnectionRecord) { return tools; }
  async disconnect(_id: string) {}
}
