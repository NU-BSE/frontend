/**
 * The model download must not carry bytes through JavaScript.
 *
 * This is a source check rather than a behavioural one, and deliberately so:
 * the failure it guards against is an OutOfMemoryError on a real phone
 * partway through a 1.8 GB download, which no test on a laptop reproduces and
 * which costs a user twenty minutes to discover.
 *
 *     OutOfMemoryError: Failed to allocate a 8388627 byte allocation with
 *     6475008 free bytes ... growth limit 268435456
 *
 * That was an 8 MB range read as `arrayBuffer()` and written to the file,
 * against a 256 MB heap, while expo's fetch still held its own copy. Shrinking
 * the chunk only lowers the odds; the fix is that the bytes never enter the
 * heap at all — `createDownloadResumable` writes from native code and reports
 * a number.
 *
 * So what is checked is that the download path cannot materialise a body: any
 * reintroduction of `arrayBuffer`, `blob` or a large typed array is the old
 * design coming back.
 *
 * Run: npm run verify:model-install
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  ok — ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL — ${message}`);
  }
}

const source = readFileSync(
  path.join(process.cwd(), 'src/ai/modelInstall.ts'),
  'utf8',
);

// Comments describe the failure at length, so only executable lines count.
const code = source
  .split('\n')
  .filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.length > 0 &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('/*') &&
      !trimmed.startsWith('//')
    );
  })
  .join('\n');

console.log('the download never holds the body:');

assert(
  !/\.arrayBuffer\s*\(/u.test(code),
  'no arrayBuffer() — that is the allocation that overflowed the heap',
);
assert(!/\.blob\s*\(/u.test(code), 'no blob()');
assert(
  !/new\s+Uint8Array\s*\(/u.test(code),
  'no Uint8Array construction in the download path',
);
assert(
  !/\bCHUNK_BYTES\b/u.test(code),
  'no manual chunking — the native task owns the transfer',
);

console.log('\nit uses the API that streams and reports:');

assert(
  /createDownloadResumable/u.test(code),
  'createDownloadResumable, which writes natively and reports bytes written',
);
assert(
  /pauseAsync/u.test(code) && /resumeAsync/u.test(code),
  'pause and resume, so a stopped 1.8 GB download is not restarted',
);
assert(
  /resumeData/u.test(code),
  'the resume token is handled — it is the only way back to a partial file',
);

console.log('\nintegrity and cleanup:');

assert(
  /finished\.size\s*!==\s*entry\.bytes/u.test(code),
  'the finished file is checked against the published length',
);
assert(
  /RESUME_KEY_PREFIX/u.test(code) && /multiRemove/u.test(code),
  'removing the model clears resume tokens, which would otherwise point at files that are gone',
);

/*
 * And a behavioural half, because the source check above cannot see the
 * mistake that actually shipped.
 *
 * `verifyInstalled` fed the stored path straight into `new File(...)`. The
 * record holds a plain absolute path — llama.rn needs one — while
 * expo-file-system is URI-based, and on Android the class ends at
 * `File(URI.create(uri.toString()))`, which throws for a URI with no scheme.
 * `verifyInstalled` catches everything and answers `false`, so a complete
 * 1.1 GB install failed its own check on every launch: the engine fell back
 * to the stub and the account screen said "The on-device model has not been
 * downloaded yet" to someone looking at the model they had just downloaded.
 *
 * The stub throws on a scheme-less argument exactly as the platform does. One
 * that returned `exists === false` instead would let this back in silently.
 */
const { verifyInstalled } = await import('../src/ai/modelInstall.js');

interface StubEntry {
  size: number;
}
/*
 * Read through a function, not captured once. `modelInstall` requires
 * expo-file-system lazily, so the stub module is first evaluated partway
 * through these checks — after this file has run. Both sides adopt whichever
 * map is already on `globalThis`.
 */
function fsFiles(): Map<string, StubEntry> {
  const slot = globalThis as { __fsFiles?: Map<string, StubEntry> };
  slot.__fsFiles ??= new Map<string, StubEntry>();
  return slot.__fsFiles;
}

const WEIGHTS = '/data/user/0/im.creepy.app/files/models/model.gguf';
const PROJECTOR = '/data/user/0/im.creepy.app/files/models/mmproj.gguf';

function present(...entries: [string, number][]): void {
  const files = fsFiles();
  files.clear();
  for (const [path, size] of entries) files.set(`file://${path}`, { size });
}

console.log('\na complete install verifies:');

present([WEIGHTS, 100], [PROJECTOR, 20]);
assert(
  await verifyInstalled({
    profile: 'on-device',
    model: 'gui-owl-2b',
    path: WEIGHTS,
    projectorPath: PROJECTOR,
    files: [
      { path: WEIGHTS, bytes: 100, role: 'weights' },
      { path: PROJECTOR, bytes: 20, role: 'projector' },
    ],
    bytes: 120,
    installedAt: 0,
  }),
  'a record holding plain paths verifies against the files on disk',
);

assert(
  await verifyInstalled({
    profile: 'on-device',
    model: 'gui-owl-2b',
    path: WEIGHTS,
    projectorPath: null,
    files: [],
    bytes: 100,
    installedAt: 0,
  }),
  'and so does a legacy record with no per-file lengths',
);

console.log('\nand a broken one does not:');

present([WEIGHTS, 99], [PROJECTOR, 20]);
assert(
  !(await verifyInstalled({
    profile: 'on-device',
    model: 'gui-owl-2b',
    path: WEIGHTS,
    projectorPath: PROJECTOR,
    files: [
      { path: WEIGHTS, bytes: 100, role: 'weights' },
      { path: PROJECTOR, bytes: 20, role: 'projector' },
    ],
    bytes: 120,
    installedAt: 0,
  })),
  'a truncated file fails, which is the check the size comparison is for',
);

present([WEIGHTS, 100]);
assert(
  !(await verifyInstalled({
    profile: 'on-device',
    model: 'gui-owl-2b',
    path: WEIGHTS,
    projectorPath: PROJECTOR,
    files: [
      { path: WEIGHTS, bytes: 100, role: 'weights' },
      { path: PROJECTOR, bytes: 20, role: 'projector' },
    ],
    bytes: 120,
    installedAt: 0,
  })),
  'and so does a missing second file',
);

if (failures > 0) {
  console.error(`\nmodel install: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nverify:model-install — all checks passed');
