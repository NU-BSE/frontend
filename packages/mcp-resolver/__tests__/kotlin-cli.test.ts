import path from 'node:path';

import {
  KotlinCliResolver,
  locateCli,
} from '../src/kotlinCli';
import { McpResolutionError } from '../src/errors';

const fixture = path.resolve(__dirname, 'fixtures', 'mock-resolver-cli.mjs');

describe('KotlinCliResolver', () => {
  it('resolves a directory source through the mock CLI', async () => {
    const resolver = new KotlinCliResolver({
      cliCommand: process.execPath,
      cliArgs: [fixture],
    });

    const resolved = await resolver.resolve({ type: 'directory', path: '/tmp/repo' });

    expect(resolved.command).toBe('node');
    expect(resolved.args).toEqual(['dist/index.js']);
    expect(resolved.workingDirectory).toBe('/tmp/repo');
    expect(resolved.requiredEnvironmentVariables.map((v) => v.name)).toEqual(['GITHUB_TOKEN']);
  });

  it('sends repository refs to the CLI', async () => {
    const resolver = new KotlinCliResolver({
      cliCommand: process.execPath,
      cliArgs: [fixture],
    });

    // A successful resolution proves the source JSON (with ref) was accepted.
    await expect(
      resolver.resolve({ type: 'repository', url: 'https://github.com/x/y', ref: 'main' }),
    ).resolves.toMatchObject({ runtime: 'NODE' });
  });

  it('maps structured resolver errors', async () => {
    const resolver = new KotlinCliResolver({
      cliCommand: process.execPath,
      cliArgs: [fixture, 'error'],
    });

    await expect(
      resolver.resolve({ type: 'directory', path: '/tmp/nope' }),
    ).rejects.toMatchObject({
      name: 'McpResolutionError',
      type: 'NoDetectorMatched',
      hints: ['Supported runtimes: Node.js, Python, JVM.'],
    });
  });

  it('fails with ProcessSpawnFailed on a non-zero exit', async () => {
    const resolver = new KotlinCliResolver({
      cliCommand: process.execPath,
      cliArgs: [fixture, 'exit-fail'],
    });

    const error = await resolver
      .resolve({ type: 'directory', path: '/tmp/nope' })
      .then(() => null)
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(McpResolutionError);
    expect((error as McpResolutionError).type).toBe('ProcessSpawnFailed');
  });

  it('times out and kills a hanging resolver', async () => {
    const resolver = new KotlinCliResolver({
      cliCommand: process.execPath,
      cliArgs: [fixture, 'hang'],
      timeoutMs: 800,
    });

    const started = Date.now();
    const error = await resolver
      .resolve({ type: 'directory', path: '/tmp/nope' })
      .then(() => null)
      .catch((err: unknown) => err);
    expect(Date.now() - started).toBeGreaterThanOrEqual(700);
    expect((error as McpResolutionError).type).toBe('ProcessSpawnFailed');
  });

  it('locateCli honours MCP_RESOLVER_CLI', () => {
    const previous = process.env.MCP_RESOLVER_CLI;
    process.env.MCP_RESOLVER_CLI = 'node ./some/cli.mjs';

    try {
      expect(locateCli()).toEqual({ command: 'node', args: ['./some/cli.mjs'] });
    } finally {
      if (previous === undefined) delete process.env.MCP_RESOLVER_CLI;
      else process.env.MCP_RESOLVER_CLI = previous;
    }
  });
});