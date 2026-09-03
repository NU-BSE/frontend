/**
 * End-to-end resolver integration check:
 *
 *   fixture repository
 *     → Kotlin resolver-cli (detect + resolve over JSON stdio)
 *     → ResolvedMcp
 *     → StdioClientTransport + Client (initialize handshake)
 *     → tools/list
 *     → callTool
 *     → close
 *
 * Requires the Kotlin CLI build (JVM). Skips with a build hint when it is not
 * available so the regular verify chain stays JVM-free.
 *
 * Run: npm run verify:resolver
 */
import {
  createMcpToolset,
  isCliAvailable,
  McpResolutionError,
  resolveMcp,
} from '@mobile-agent/mcp-resolver';
import path from 'node:path';
import { existsSync } from 'node:fs';

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (
      existsSync(path.join(dir, 'package.json')) &&
      existsSync(path.join(dir, 'packages'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start, '..', '..');
}

const repoRoot = findRepoRoot(__dirname);
const repo = path.join(
  repoRoot,
  'packages',
  'mcp-resolver',
  '__tests__',
  'fixtures',
  'mcp-server-repo',
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
  return content
    .filter((block): block is { type: string; text: string } => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

async function main(): Promise<void> {
  if (!isCliAvailable()) {
    console.log(
      'SKIP — resolver-cli is not built. Build it with:\n' +
        '  cd resolver && ./gradlew installDist fatJar',
    );
    return;
  }

  console.log('resolution:');

  const resolved = await resolveMcp(
    { type: 'directory', path: repo },
    { prepare: false, validate: true },
    (line) => console.log(`  [resolver] ${line}`),
  );

  console.log(`  resolved command: ${resolved.command} ${resolved.args.join(' ')}`);
  assert(resolved.command === 'node', 'resolver detects a Node.js MCP project');
  assert(resolved.args.join(' ').includes('dist/index.mjs'), 'resolver finds the bin entrypoint');
  assert(resolved.runtime === 'NODE', 'runtime is NODE');
  assert(
    resolved.evidence.some((item) => item.includes('README')),
    'README MCP config is used as evidence',
  );
  assert(
    resolved.requiredEnvironmentVariables.some((v) => v.name === 'FIXTURE_OPTIONAL' && !v.required),
    'optional environment variables are reported without inventing values',
  );

  console.log('MCP connection:');

  const toolset = await createMcpToolset(resolved, {
    logger: (line) => console.log(`  [server] ${line}`),
    connectTimeoutMs: 15_000,
  });

  const tools = await toolset.listTools();
  const names = tools.map((tool) => tool.name);
  assert(names.includes('fixture.echo'), 'tools/list exposes fixture.echo');
  assert(names.includes('fixture.answer'), 'tools/list exposes fixture.answer');
  console.log(`  discovered ${names.length} MCP tools`);

  const result = await toolset.callTool({ name: 'fixture.answer', arguments: {} });
  assert(textOf(result) === '42', 'calling fixture.answer returns 42');

  const pid = toolset.pid;
  await toolset.close();
  assert(!isAlive(pid), 'MCP subprocess is terminated on close');

  console.log('error mapping:');

  const unknownRepo = path.join(repoRoot, 'node_modules', '.cache', `unknown-repo-${Date.now()}`);
  const { mkdirSync, rmSync } = await import('node:fs');
  mkdirSync(unknownRepo, { recursive: true });
  const error = await resolveMcp({ type: 'directory', path: unknownRepo })
    .then(() => null)
    .catch((err: unknown) => err);
  rmSync(unknownRepo, { recursive: true, force: true });
  assert(error instanceof McpResolutionError, 'resolution of an unknown repo fails');
  assert((error as McpResolutionError).type === 'NoDetectorMatched', 'unknown repo → NoDetectorMatched');

  const missing = await resolveMcp({ type: 'directory', path: '/definitely/not/a/repo' })
    .then(() => null)
    .catch((err: unknown) => err);
  assert(missing instanceof McpResolutionError, 'resolution of a missing path fails');
  assert(
    (missing as McpResolutionError).type === 'UnsupportedRepository',
    'missing path → UnsupportedRepository',
  );

  console.log('resolver integration: all checks passed');
}

function isAlive(pid: number | null): boolean {
  if (pid === null || pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});