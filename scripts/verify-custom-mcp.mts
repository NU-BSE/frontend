/**
 * Custom MCP server integration.
 *
 * Servers are translated by the backend into a JavaScript bundle and then run
 * *on this device*. Covers the four places that can go quietly wrong:
 *
 *  1. A backend response carrying environment *values* must not reach storage.
 *     The persisted record is AsyncStorage — plaintext — and the shape that
 *     reaches disk cannot be allowed to express a secret.
 *  2. Re-translating changes what a server needs. A value held for a variable
 *     that is no longer required must stop counting toward "configured", or a
 *     server reads as ready while missing something it now needs. Its secret
 *     must also be deleted rather than orphaned.
 *  3. A refusal must survive as itself. "This is a Python server, which cannot
 *     run on a phone" is not a transient error to retry, and flattening it to
 *     a generic failure would invite exactly that.
 *  4. Nothing in the device-side code may import `@mobile-agent/mcp-resolver`
 *     for a value. That package reaches for `node:child_process`; one
 *     `import {}` where `import type {}` was meant pulls it into the Metro
 *     bundle and breaks the app at startup.
 *
 * Run: npm run verify:custom-mcp
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  defaultLabel,
  missingEnvironment,
  statusOf,
  type CustomMcpServer,
  type DetectedMcp,
} from '../src/mcp/custom/types.js';
import { CustomMcpError, toDetected, toError } from '../src/mcp/custom/resolverClient.js';
import { ApiError } from '../src/api/client.js';
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
  const response = {
    bundleId: 'a'.repeat(32),
    runtime: 'NODE',
    entrypoint: 'src/index.mjs',
    confidence: 0.95,
    evidence: ['package.json: bin.weather-mcp'],
    requiredEnvironment: [
      { name: 'OPENWEATHER_API_KEY', required: true, description: 'From openweathermap.org' },
      { name: 'UNITS', required: true },
    ],
    sha256: 'a'.repeat(64),
    bytes: 544275,
    downloadUrl: '/mcp/bundles/' + 'a'.repeat(32),
    // A backend that echoed a caller-supplied value back would be a leak the
    // moment this object is persisted.
    environment: { OPENWEATHER_API_KEY: 'owm_realsecretvalue' },
  };
  const detected = toDetected(response as never);
  assert(
    !JSON.stringify(detected).includes('owm_realsecretvalue'),
    'an echoed environment value is dropped before storage',
  );
  assert(
    !Object.prototype.hasOwnProperty.call(detected, 'environment'),
    'the stored shape has no environment field at all',
  );
  assert(
    detected.sha256.length === 64 && detected.bundleId.length === 32,
    'the bundle is identified by its digest, which is what gets verified before it runs',
  );
  assert(
    !('command' in detected) && !('args' in detected),
    'nothing is launched, so nothing stores a command line',
  );

  console.log('\nerror mapping:');
  const python = toError(
    new ApiError('This is a Python MCP server, which cannot run on a phone.', 422, 'RuntimeNotSupported', [
      'Found pyproject.toml.',
    ]),
  );
  assert(python.type === 'RuntimeNotSupported', 'a refusal keeps the reason it was refused for');
  assert(python.hints.includes('Found pyproject.toml.'), 'the actionable hint survives');
  assert(
    python.message.includes('Python'),
    'the backend message reaches the user verbatim',
  );

  const unknown = toError(new ApiError('Something new', 422, 'SomethingNew'));
  assert(
    unknown.type === 'HostUnavailable',
    'an unrecognised code does not become a fabricated error type',
  );

  const offline = toError(new ApiError('Could not reach the server.', 0, 'network_error'));
  assert(offline.type === 'HostUnavailable', 'a transport failure is not a translation failure');
  assert(
    offline.hints.some((hint) => hint.includes('run on this device')),
    'and it says the server itself still runs locally',
  );

  const plain = toError(new Error('boom'));
  assert(plain instanceof CustomMcpError, 'any thrown value becomes a typed error');

  console.log('\nstore:');
  const server = await addCustomServer(
    { type: 'repository', url: 'https://github.com/example/weather-mcp' },
    { detected },
  );
  assert(server.label === 'weather-mcp', 'the label defaults to the repository name');
  assert(statusOf(server) === 'needs-configuration', 'a server missing a token is not ready');
  assert(
    missingEnvironment(server).map((item) => item.name).join(',') ===
      'OPENWEATHER_API_KEY,UNITS',
    'every missing variable is named, not just the first',
  );

  await setEnvironmentValue(server.id, 'OPENWEATHER_API_KEY', 'owm_value');
  const [partial] = await listCustomServers();
  assert(
    statusOf(partial!) === 'needs-configuration',
    'satisfying one of two required variables is not ready',
  );

  await setEnvironmentValue(server.id, 'UNITS', 'metric');
  const [configured] = await listCustomServers();
  assert(statusOf(configured!) === 'ready', 'supplying the rest makes the server ready');
  assert(
    JSON.stringify(configured).includes('OPENWEATHER_API_KEY') &&
      !JSON.stringify(configured).includes('owm_value'),
    'the record stores the variable name but never its value',
  );
  assert(
    (await readEnvironment(server.id)).OPENWEATHER_API_KEY === 'owm_value',
    'the value is readable from the vault when a server is actually started',
  );

  console.log('\nre-resolution:');
  const renamedVariable: DetectedMcp = {
    ...detected,
    requiredEnvironmentVariables: [{ name: 'OWM_KEY', required: true }],
  };
  const reresolved = await updateDetection(server.id, renamedVariable);
  assert(
    statusOf(reresolved as CustomMcpServer) === 'needs-configuration',
    'a renamed variable makes a previously-ready server need configuration again',
  );
  assert(
    !reresolved!.configuredEnvironment.includes('OPENWEATHER_API_KEY'),
    'a value for a no-longer-required variable stops counting as configured',
  );
  assert(
    __vaultReferences().length === 0,
    'and every secret for a dropped variable is deleted, not orphaned',
  );

  console.log('\nremoval:');
  await setEnvironmentValue(server.id, 'OWM_KEY', 'owm_new');
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

  if (failures > 0) {
    console.error(`\ncustom MCP: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nverify:custom-mcp — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
