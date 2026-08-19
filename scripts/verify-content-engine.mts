/**
 * Architecture + privacy tests for @mobile-agent/content-engine.
 *
 * Verifies the non-negotiable invariants of the local-only document engine:
 * private content routes to the local model only, credentials never reach a
 * prompt, the data-boundary policy forbids off-device processing, and the
 * package has no remote-processing or cloud-AI dependency.
 *
 * Run: npm run verify:content-engine
 */
/// <reference types="node" />

import {
  DEFAULT_DATA_BOUNDARY_POLICY,
  DocumentError,
  classifyDocument,
  classifySource,
  isPromptAllowed,
  localProcessingUnsupported,
  routeModel,
} from '@mobile-agent/content-engine';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (expected ${String(expected)}, got ${String(actual)})`);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const CONTENT_ENGINE_SRC = 'packages/content-engine/src';

const FORBIDDEN_IMPORTS = [
  'openrouter',
  'google-cloud',
  'cloud-vision',
  'textract',
  'azure',
  'aws-sdk',
  '@aws-sdk',
];

async function main(): Promise<void> {
  console.log('model routing keeps private content local:');
  {
    assertEq(routeModel('user-private'), 'local', 'user-private → local');
    assertEq(routeModel('sensitive'), 'local', 'sensitive → local');
    assertEq(routeModel('public'), 'cloud', 'public → cloud');
  }

  console.log('credentials never become prompt context:');
  {
    assertEq(isPromptAllowed('credential'), false, 'credential is blocked');
    assertEq(isPromptAllowed('user-private'), true, 'user-private is allowed (locally)');
    assertEq(isPromptAllowed('public'), true, 'public is allowed');
  }

  console.log('sources default to user-private:');
  {
    assertEq(classifySource('google_drive'), 'user-private', 'google_drive is private');
    assertEq(classifySource('local'), 'user-private', 'local is private');
    assertEq(classifySource('telegram'), 'user-private', 'telegram is private');
    assertEq(
      classifyDocument({ id: 'd', source: 'local', name: 'x', metadata: { classification: 'public' } }),
      'public',
      'explicit metadata override wins',
    );
  }

  console.log('data boundary policy is a non-negotiable invariant:');
  {
    assertEq(DEFAULT_DATA_BOUNDARY_POLICY.localProcessingOnly, true, 'localProcessingOnly');
    assertEq(DEFAULT_DATA_BOUNDARY_POLICY.allowFirstPartyProcessingUpload, false, 'no first-party upload');
    assertEq(DEFAULT_DATA_BOUNDARY_POLICY.allowThirdPartyAi, false, 'no third-party AI');
    assertEq(DEFAULT_DATA_BOUNDARY_POLICY.allowProviderTransport, true, 'provider transport allowed');
  }

  console.log('unsupported operations surface a local-only error, not a cloud fallback:');
  {
    const error = localProcessingUnsupported('too large for this device');
    assert(error instanceof DocumentError, 'returns a DocumentError');
    assertEq(error.code, 'LOCAL_PROCESSING_UNSUPPORTED', 'code is LOCAL_PROCESSING_UNSUPPORTED');
  }

  console.log('no remote-processing target exists:');
  {
    const targetSource = readFileSync(
      join(CONTENT_ENGINE_SRC, 'execution/execution-target.ts'),
      'utf8',
    );
    // A quoted "remote" string literal would mean a remote target value; prose
    // mentioning "no remote route" in comments is fine and expected.
    assert(!/['"]remote['"]/u.test(targetSource), 'execution-target has no "remote" target value');
    assert(targetSource.includes("'js'"), 'execution-target exposes js');
    assert(targetSource.includes("'native'"), 'execution-target exposes native');
  }

  console.log('no cloud-AI / backend-processing dependency:');
  {
    let violations: string[] = [];
    for (const file of sourceFiles(CONTENT_ENGINE_SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN_IMPORTS) {
        if (text.includes(token)) violations.push(`${file} mentions ${token}`);
      }
    }
    assertEq(violations.length, 0, 'no forbidden import/mention in content-engine source');
  }

  console.log('verify:content-engine — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
