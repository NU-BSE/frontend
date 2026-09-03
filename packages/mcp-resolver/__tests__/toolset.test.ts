import path from 'node:path';

import {
  createMcpToolset,
  McpResolutionError,
} from '../src/index';
import { McpToolsetManager } from '../src/manager';
import type { ResolvedMcp } from '../src/types';

const fixture = path.resolve(__dirname, 'fixtures', 'mock-mcp-server.mjs');

function fixtureResolved(): ResolvedMcp {
  return {
    command: process.execPath,
    args: [fixture],
    environment: {},
    workingDirectory: null,
    requiredEnvironmentVariables: [],
    runtime: 'NODE',
    confidence: 1,
    evidence: ['fixture'],
    requiresPreparation: false,
    launchDescription: 'fixture stdio server',
  };
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
  return content
    .filter((block): block is { type: string; text: string } => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

describe('createMcpToolset (framework adapter over a real stdio server)', () => {
  it(
    'spawns the server, performs the MCP handshake, discovers and calls tools, and closes',
    async () => {
      const stderr: string[] = [];
      const toolset = await createMcpToolset(fixtureResolved(), {
        logger: (line) => stderr.push(line),
        connectTimeoutMs: 10_000,
      });

      expect(toolset.pid).toBeTruthy();

      const tools = await toolset.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain('fixture.echo');
      expect(names).toContain('fixture.answer');

      const result = await toolset.callTool({
        name: 'fixture.echo',
        arguments: { text: 'hello' },
      });
      expect(textOf(result)).toBe('echo: hello');

      const answer = await toolset.callTool({ name: 'fixture.answer', arguments: {} });
      expect(textOf(answer)).toBe('42');

      const pid = toolset.pid;
      await toolset.close();
      expect(isProcessAlive(pid)).toBe(false);
    },
    30_000,
  );

  it('fails the handshake cleanly when the command is wrong', async () => {
    const broken = fixtureResolved();
    broken.args = ['definitely-missing-script-that-does-not-exist.mjs'];

    await expect(createMcpToolset(broken, { connectTimeoutMs: 5_000 })).rejects.toBeInstanceOf(
      McpResolutionError,
    );
  }, 30_000);

  it('rejects missing required environment variables', async () => {
    const resolved = fixtureResolved();
    resolved.requiredEnvironmentVariables = [{ name: 'GITHUB_TOKEN', required: true }];

    const error = await createMcpToolset(resolved)
      .then(() => null)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(McpResolutionError);
    expect((error as McpResolutionError).type).toBe('MissingEnvironment');
    expect((error as McpResolutionError).message).toContain('GITHUB_TOKEN');
  });

  it('manager reuses one process per key and closes all on shutdown', async () => {
    const manager = new McpToolsetManager({ logger: () => undefined });
    const resolved = fixtureResolved();

    const a = await manager.get('same', resolved);
    const b = await manager.get('same', resolved);
    expect(a).toBe(b);
    expect(manager.size).toBe(1);

    const pid = a.pid;
    await manager.closeAll();
    expect(manager.size).toBe(0);
    expect(isProcessAlive(pid)).toBe(false);
  }, 30_000);
});

function isProcessAlive(pid: number | null): boolean {
  if (pid === null || pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}