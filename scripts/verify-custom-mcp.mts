/**
 * Custom MCP server integration.
 *
 * Covers the three places this can go quietly wrong:
 *
 *  1. A resolver response carrying environment *values* must not reach
 *     storage. The resolver may echo back variables the caller supplied, and
 *     the persisted record is AsyncStorage — plaintext. The shape that reaches
 *     disk cannot be allowed to express a secret.
 *  2. Re-resolving changes what a server needs. A value held for a variable
 *     that is no longer required must stop counting toward "configured", or a
 *     server reads as ready while missing something it now needs.
 *  3. Nothing in the device-side code may import `@mobile-agent/mcp-resolver`
 *     for a value. That package reaches for `node:child_process`; one
 *     `import {}` where `import type {}` was meant pulls it into the Metro
 *     bundle and breaks the app at startup.
 *
 * Run: npm run verify:custom-mcp
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';

import type { ResolvedMcp, McpResolutionErrorType } from '@mobile-agent/mcp-resolver';

import {
  defaultLabel,
  missingEnvironment,
  statusOf,
  type CustomMcpServer,
  type DetectedMcp,
} from '../src/mcp/custom/types.js';
import { toDetected, toError, type CustomMcpErrorType } from '../src/mcp/custom/resolverClient.js';
import {
  addCustomServer,
  listCustomServers,
  readEnvironment,
  removeCustomServer,
  setEnvironmentValue,
  updateDetection,
} from '../src/mcp/custom/store.js';
import { __vaultReferences } from './stubs/runtime-singleton.mjs';

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  ok — ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL — ${message}`);
  }
}

/*
 * Type-level parity with the resolver package, checked by tsc rather than at
 * runtime. `DetectedMcp` mirrors `ResolvedMcp` by hand to keep Node code out
 * of the bundle; these assignments are what stop the copy drifting. If the
 * resolver renames a field or changes a type, this file stops compiling.
 */
type FieldsMatch = {
  [K in keyof DetectedMcp]: K extends keyof ResolvedMcp
    ? DetectedMcp[K] extends ResolvedMcp[K]
      ? true
      : never
    : never;
};
const _fieldsMatch: FieldsMatch = {
  runtime: true,
  command: true,
  args: true,
  workingDirectory: true,
  requiredEnvironmentVariables: true,
  confidence: true,
  evidence: true,
  requiresPreparation: true,
  launchDescription: true,
};
void _fieldsMatch;

/* Every resolver error type must be representable by the app's union. */
const _errorsMatch: CustomMcpErrorType = null as unknown as McpResolutionErrorType;
void _errorsMatch;

async function main(): Promise<void> {
  console.log('labels:');
  assert(
    defaultLabel({ type: 'repository', url: 'https://github.com/example/weather-mcp.git' }) ===
      'weather-mcp',
    '.git is stripped from a repository name',
  );
  assert(
    defaultLabel({ type: 'repository', url: 'https://github.com/example/weather-mcp/' }) ===
      'weather-mcp',
    'a trailing slash does not become the name',
  );
  assert(
    defaultLabel({ type: 'directory', path: '/home/me/servers/notes-mcp' }) === 'notes-mcp',
    'a directory is named after its last segment',
  );

  console.log('\nsecrets never reach the stored shape:');
  const parsedWithSecrets = {
    command: 'node',
    args: ['dist/index.js'],
    workingDirectory: '/tmp/repo',
    requiredEnvironmentVariables: [{ name: 'GITHUB_TOKEN', required: true }],
    runtime: 'NODE' as const,
    confidence: 0.9,
    evidence: ['package.json: bin.mcp-server'],
    requiresPreparation: false,
    launchDescription: 'node dist/index.js',
    // A host that echoes the caller's environment back.
    environment: { GITHUB_TOKEN: 'ghp_realsecretvalue' },
  };
  const detected = toDetected(parsedWithSecrets as never);
  assert(
    !JSON.stringify(detected).includes('ghp_realsecretvalue'),
    'an echoed environment value is dropped before storage',
  );
  assert(
    !Object.prototype.hasOwnProperty.call(detected, 'environment'),
    'the stored shape has no environment field at all',
  );

  console.log('\nerror mapping:');
  const known = toError({ error: { type: 'NoDetectorMatched', message: 'Not an MCP server.' } }, 422);
  assert(known.type === 'NoDetectorMatched', 'a known resolver error keeps its type');
  assert(known.message === 'Not an MCP server.', 'the resolver message is shown verbatim');
  const unknown = toError({ error: { type: 'SomethingNew' } }, 500);
  assert(
    unknown.type === 'HostUnavailable',
    'an unrecognised error type does not become a fabricated one',
  );
  const garbage = toError('<html>502 Bad Gateway</html>', 502);
  assert(garbage.type === 'HostUnavailable', 'a non-JSON body maps to HostUnavailable');
  assert(garbage.message.includes('502'), 'the status code survives into the message');

  console.log('\nstore:');
  const server = await addCustomServer(
    { type: 'repository', url: 'https://github.com/example/weather-mcp' },
    { detected },
  );
  assert(server.label === 'weather-mcp', 'the label defaults to the repository name');
  assert(statusOf(server) === 'needs-configuration', 'a server missing a token is not ready');
  assert(
    missingEnvironment(server).map((item) => item.name).join(',') === 'GITHUB_TOKEN',
    'the missing variable is named',
  );

  await setEnvironmentValue(server.id, 'GITHUB_TOKEN', 'ghp_value');
  const [configured] = await listCustomServers();
  assert(statusOf(configured!) === 'ready', 'supplying the token makes the server ready');
  assert(
    JSON.stringify(configured).includes('GITHUB_TOKEN') &&
      !JSON.stringify(configured).includes('ghp_value'),
    'the record stores the variable name but never its value',
  );
  assert(
    (await readEnvironment(server.id)).GITHUB_TOKEN === 'ghp_value',
    'the value is readable from the vault when a server is actually started',
  );

  console.log('\nre-resolution:');
  const renamedVariable: DetectedMcp = {
    ...detected,
    requiredEnvironmentVariables: [{ name: 'GH_TOKEN', required: true }],
  };
  const reresolved = await updateDetection(server.id, renamedVariable);
  assert(
    statusOf(reresolved as CustomMcpServer) === 'needs-configuration',
    'a renamed variable makes a previously-ready server need configuration again',
  );
  assert(
    !reresolved!.configuredEnvironment.includes('GITHUB_TOKEN'),
    'a value for a no-longer-required variable stops counting as configured',
  );
  assert(
    __vaultReferences().length === 0,
    'and its secret is deleted rather than orphaned in the vault',
  );

  console.log('\nremoval:');
  await setEnvironmentValue(server.id, 'GH_TOKEN', 'gh_value');
  assert(__vaultReferences().length === 1, 'the new value is stored before removal');
  await removeCustomServer(server.id);
  assert((await listCustomServers()).length === 0, 'the record is gone');
  assert(
    __vaultReferences().length === 0,
    'every secret the server owned is deleted, not orphaned',
  );

  console.log('\nno Node builtins reachable from the app:');
  const deviceSources = [
    'src/mcp/custom/types.ts',
    'src/mcp/custom/store.ts',
    'src/mcp/custom/resolverClient.ts',
    'src/mcp/custom/useCustomServers.ts',
    'app/connect/custom.tsx',
  ];
  for (const relative of deviceSources) {
    const text = readFileSync(path.join(process.cwd(), relative), 'utf8');
    const valueImport = /^import\s+(?!type\b)[^;]*from\s+'@mobile-agent\/mcp-resolver'/mu.test(text);
    assert(!valueImport, `${relative} does not value-import the resolver package`);
    assert(
      !/from\s+'node:/u.test(text),
      `${relative} imports no node: builtin`,
    );
  }

  console.log('\nresolver host transport:');
  await checkTransport();

  if (failures > 0) {
    console.error(`\ncustom MCP: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nverify:custom-mcp — all checks passed');
}

/**
 * The HTTP path against a real server.
 *
 * A stubbed `fetch` would prove the code calls something; a real socket proves
 * the request shape, the JSON contract and the error mapping the host actually
 * sees. The module reads its host URL at import time, so it is imported only
 * after the server is listening and the variable is set.
 */
async function checkTransport(): Promise<void> {
  const requests: Array<{ url: string; body: unknown }> = [];

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      requests.push({ url: req.url ?? '', body: JSON.parse(raw || '{}') });
      if (requests.length === 1) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            command: 'python',
            args: ['-m', 'notes_mcp'],
            runtime: 'PYTHON',
            confidence: 0.75,
            evidence: ['pyproject.toml: project.scripts.notes-mcp'],
            requiredEnvironmentVariables: [
              { name: 'NOTES_DIR', required: true, description: 'Where notes live' },
            ],
            requiresPreparation: true,
            environment: { NOTES_DIR: '/should/not/be/stored' },
          }),
        );
        return;
      }
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { type: 'NoDetectorMatched', message: 'No MCP server found.', hints: ['Check the ref.'] },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  process.env.EXPO_PUBLIC_MCP_RESOLVER_URL = `http://127.0.0.1:${port}/`;

  try {
    const client = await import('../src/mcp/custom/resolverClient.js');
    assert(client.hasResolverHost(), 'a configured host is reported as available');

    const result = await client.resolveCustomMcp({
      type: 'repository',
      url: 'https://github.com/example/notes-mcp',
      ref: 'main',
    });

    assert(requests[0]!.url === '/resolve', 'the request goes to /resolve');
    const sent = requests[0]!.body as { source: unknown; prepare: boolean };
    assert(
      JSON.stringify(sent.source) ===
        JSON.stringify({ type: 'repository', url: 'https://github.com/example/notes-mcp', ref: 'main' }),
      'the source, including the ref, reaches the host unchanged',
    );
    assert(sent.prepare === false, 'preparation is off unless asked for');
    assert(result.runtime === 'PYTHON', 'the detected runtime is read back');
    assert(result.workingDirectory === null, 'an absent working directory becomes null');
    assert(
      !JSON.stringify(result).includes('/should/not/be/stored'),
      'the transport drops an echoed environment value too',
    );

    const failure = await client
      .resolveCustomMcp({ type: 'repository', url: 'https://github.com/example/not-mcp' })
      .then(() => null)
      .catch((error: unknown) => error);
    assert(
      failure instanceof client.CustomMcpError && failure.type === 'NoDetectorMatched',
      'a resolver error crosses the wire with its type intact',
    );
    assert(
      (failure as InstanceType<typeof client.CustomMcpError>).hints.includes('Check the ref.'),
      'the resolver hints reach the user',
    );
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
