import * as z from 'zod/v4';
import type { Connector, ConnectionRecord, ConnectorTool } from '@mobile-agent/connector-core';
import { connId, mockConn, opt, str, t } from '@mobile-agent/connector-core';

const CONN = mockConn('dropbox', 'Dropbox');

const tools: ConnectorTool[] = [
  t('dropbox.files.list', 'List files', 'List files in a folder', 'read',
    z.object({ connectionId: str, path: str.default('') }),
    { entries: [{ name: 'report.pdf', path_display: '/report.pdf', '.tag': 'file' }] }),
  t('dropbox.files.search', 'Search files', 'Search Dropbox files', 'read',
    z.object({ connectionId: str, query: str }),
    { matches: [{ metadata: { '.tag': 'file', name: 'report.pdf', path_display: '/report.pdf' } }] }),
  t('dropbox.files.get_metadata', 'Get metadata', 'Get file or folder metadata', 'read',
    z.object({ connectionId: str, path: str }),
    { name: 'report.pdf', path_display: '/report.pdf', '.tag': 'file', size: 102400 }),
  t('dropbox.files.download', 'Download', 'Download a file', 'read',
    z.object({ connectionId: str, path: str }),
    { path: '/report.pdf', name: 'report.pdf', localUri: 'file://mock/report.pdf' }),
  t('dropbox.files.upload', 'Upload', 'Upload a file', 'write',
    z.object({ connectionId: str, path: str, localUri: str }),
    { name: 'uploaded.txt', path_display: '/uploaded.txt' }),
  t('dropbox.files.create_folder', 'Create folder', 'Create a new folder', 'write',
    z.object({ connectionId: str, path: str }),
    { name: 'New Folder', path_display: '/New Folder' }),
  t('dropbox.files.create_shared_link', 'Create shared link', 'Create a shared link for a file', 'external_side_effect',
    z.object({ connectionId: str, path: str }),
    { url: 'https://www.dropbox.com/s/abc123/report.pdf', path: '/report.pdf' }),
  t('dropbox.files.delete', 'Delete', 'Delete a file or folder', 'destructive',
    z.object({ connectionId: str, path: str }),
    { deleted: true, path: '/report.pdf' }),
];

export class DropboxConnector implements Connector {
  readonly id = 'dropbox' as const;
  readonly displayName = 'Dropbox';
  async listConnections() { return [CONN]; }
  async getConnection(id: string) { return id === CONN.id ? CONN : null; }
  async getTools(_c: ConnectionRecord) { return tools; }
  async disconnect(_id: string) {}
}
