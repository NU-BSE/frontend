import * as z from 'zod/v4';
import type { Connector, ConnectionRecord, ConnectorTool } from '@mobile-agent/connector-core';
import { connId, mockConn, opt, str, t } from '@mobile-agent/connector-core';

const CONN = mockConn('github', 'GitHub');

const tools: ConnectorTool[] = [
  t('github.user.get', 'Get user', 'Get authenticated user', 'read',
    connId,
    { login: 'octocat', name: 'Octocat', avatar_url: 'https://github.com/octocat.png' }),
  t('github.repositories.list', 'List repos', 'List user repositories', 'read',
    connId,
    [{ id: 1, name: 'hello-world', full_name: 'octocat/hello-world', private: false }]),
  t('github.repositories.search', 'Search repos', 'Search GitHub repositories', 'read',
    z.object({ connectionId: str, query: str }),
    { items: [{ id: 1, name: 'hello-world', full_name: 'octocat/hello-world' }] }),
  t('github.issues.list', 'List issues', 'List repository issues', 'read',
    z.object({ connectionId: str, owner: str, repo: str }),
    [{ id: 1, number: 42, title: 'Bug: crash on startup', state: 'open' }]),
  t('github.issues.get', 'Get issue', 'Get a single issue', 'read',
    z.object({ connectionId: str, owner: str, repo: str, issueNumber: z.number().int() }),
    { id: 1, number: 42, title: 'Bug: crash on startup', state: 'open', body: 'Steps to reproduce...' }),
  t('github.issues.create', 'Create issue', 'Create a new issue', 'write',
    z.object({ connectionId: str, owner: str, repo: str, title: str, body: opt }),
    { id: 2, number: 43, title: 'New issue', state: 'open' }),
  t('github.issues.comment', 'Comment on issue', 'Add a comment to an issue', 'external_side_effect',
    z.object({ connectionId: str, owner: str, repo: str, issueNumber: z.number().int(), body: str }),
    { id: 100, created: true }),
  t('github.pullRequests.list', 'List PRs', 'List pull requests', 'read',
    z.object({ connectionId: str, owner: str, repo: str }),
    [{ id: 200, number: 10, title: 'Add new feature', state: 'open' }]),
  t('github.pullRequests.get', 'Get PR', 'Get a single pull request', 'read',
    z.object({ connectionId: str, owner: str, repo: str, pullNumber: z.number().int() }),
    { id: 200, number: 10, title: 'Add new feature', state: 'open', body: 'This PR adds...' }),
  t('github.pullRequests.create', 'Create PR', 'Create a pull request', 'external_side_effect',
    z.object({ connectionId: str, owner: str, repo: str, title: str, head: str, base: str, body: opt }),
    { id: 201, number: 11, title: 'New PR', state: 'open' }),
  t('github.contents.get', 'Get content', 'Get file or directory contents', 'read',
    z.object({ connectionId: str, owner: str, repo: str, path: str }),
    { name: 'README.md', path: 'README.md', content: 'IyBIZWxsbw==', encoding: 'base64' }),
  t('github.contents.update', 'Update content', 'Create or update a file', 'write',
    z.object({ connectionId: str, owner: str, repo: str, path: str, message: str, content: str }),
    { commit: { sha: 'abc123' }, content: { name: 'README.md', path: 'README.md' } }),
  t('github.actions.listRuns', 'List workflow runs', 'List workflow runs for a repo', 'read',
    z.object({ connectionId: str, owner: str, repo: str }),
    { workflow_runs: [{ id: 300, name: 'CI', status: 'completed', conclusion: 'success' }] }),
];

export class GithubConnector implements Connector {
  readonly id = 'github' as const;
  readonly displayName = 'GitHub';
  async listConnections() { return [CONN]; }
  async getConnection(id: string) { return id === CONN.id ? CONN : null; }
  async getTools(_c: ConnectionRecord) { return tools; }
  async disconnect(_id: string) {}
}
