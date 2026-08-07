import * as z from 'zod/v4';
import type { Connector, ConnectionRecord, ConnectorTool } from '@mobile-agent/connector-core';
import { connId, mockConn, opt, str, t } from '@mobile-agent/connector-core';

const CONN = mockConn('todoist', 'Todoist');

const tools: ConnectorTool[] = [
  t('todoist.projects.list', 'List projects', 'List all Todoist projects', 'read',
    connId,
    [{ id: 'p1', name: 'Work' }]),
  t('todoist.tasks.list', 'List tasks', 'List Todoist tasks', 'read',
    z.object({ connectionId: str, projectId: opt }),
    [{ id: 't1', content: 'Review PR', projectId: 'p1' }]),
  t('todoist.tasks.get', 'Get task', 'Get a single Todoist task', 'read',
    z.object({ connectionId: str, taskId: str }),
    { id: 't1', content: 'Review PR', projectId: 'p1', due: { string: 'tomorrow' } }),
  t('todoist.tasks.create', 'Create task', 'Create a new Todoist task', 'write',
    z.object({ connectionId: str, content: str, projectId: opt, dueString: opt }),
    { id: 't2', content: 'New task', projectId: 'p1' }),
  t('todoist.tasks.update', 'Update task', 'Update a Todoist task', 'write',
    z.object({ connectionId: str, taskId: str, content: opt, dueString: opt }),
    { id: 't1', updated: true }),
  t('todoist.tasks.complete', 'Complete task', 'Complete a Todoist task', 'write',
    z.object({ connectionId: str, taskId: str }),
    { id: 't1', completed: true }),
  t('todoist.tasks.delete', 'Delete task', 'Delete a Todoist task', 'destructive',
    z.object({ connectionId: str, taskId: str }),
    { deleted: true }),
  t('todoist.comments.list', 'List comments', 'List comments on a task', 'read',
    z.object({ connectionId: str, taskId: str }),
    [{ id: 'c1', content: 'Looks good!' }]),
  t('todoist.comments.create', 'Create comment', 'Add a comment to a task', 'external_side_effect',
    z.object({ connectionId: str, taskId: str, content: str }),
    { id: 'c2', created: true }),
];

export class TodoistConnector implements Connector {
  readonly id = 'todoist' as const;
  readonly displayName = 'Todoist';
  async listConnections() { return [CONN]; }
  async getConnection(id: string) { return id === CONN.id ? CONN : null; }
  async getTools(_c: ConnectionRecord) { return tools; }
  async disconnect(_id: string) {}
}
