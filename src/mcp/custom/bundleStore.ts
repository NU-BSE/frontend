/**
 * Downloading and keeping translated server bundles.
 *
 * A bundle is executable code that the app is about to run, so this module's
 * real job is the check in `verify`: the backend published a SHA-256 alongside
 * the bundle, and nothing is evaluated until the bytes on disk hash to it.
 * "Probably the right file" is not a standard worth holding executable code to,
 * and the failure it guards against — a truncated download — is ordinary
 * rather than exotic.
 *
 * Bundles are cached under the document directory rather than the cache
 * directory. A cached file the system may delete at any moment would leave a
 * configured server that cannot start, at a time nobody chose, with the
 * backend possibly unreachable — which is the one situation this whole design
 * exists to survive.
 */

import * as Crypto from 'expo-crypto';

import { downloadMcpBundle } from '@/api/client';

const DIRECTORY = 'mcp-bundles';

/** Lazily required so this module stays importable in Node verification. */
function fileSystem(): typeof import('expo-file-system') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-file-system') as typeof import('expo-file-system');
}

export class BundleIntegrityError extends Error {
  constructor(readonly expected: string, readonly actual: string) {
    super('The downloaded bundle does not match its published digest.');
    this.name = 'BundleIntegrityError';
  }
}

export async function sha256Hex(text: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

function bundleFile(bundleId: string) {
  const { Directory, File, Paths } = fileSystem();
  const directory = new Directory(Paths.document, DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true });
  return new File(directory, `${bundleId}.js`);
}

/** Whether this bundle is already on the device. */
export function isCached(bundleId: string): boolean {
  try {
    return bundleFile(bundleId).exists;
  } catch {
    return false;
  }
}

/**
 * Fetch a bundle if it is not already here, and prove it is the right one.
 *
 * The digest is checked on a cached file too, not only a freshly downloaded
 * one. A file that was truncated by a crash mid-write would otherwise pass
 * forever on the strength of its name.
 */
export async function ensureBundle(bundleId: string, sha256: string): Promise<string> {
  const file = bundleFile(bundleId);

  if (file.exists) {
    const cached = await file.text();
    const digest = await sha256Hex(cached);
    if (digest === sha256) return cached;
    // A bad cached file is deleted rather than kept: leaving it would fail the
    // same way on every launch with no path to recovery.
    file.delete();
  }

  const code = await downloadMcpBundle(bundleId);
  const digest = await sha256Hex(code);
  if (digest !== sha256) throw new BundleIntegrityError(sha256, digest);

  file.create({ overwrite: true });
  file.write(code);
  return code;
}

/**
 * The bundle as base64.
 *
 * The sandbox receives its code inside an HTML document, and base64 is what
 * makes that safe: a JavaScript bundle can contain `</script>` inside a string
 * literal, which would end the tag early and corrupt everything after it. The
 * base64 alphabet contains no `<`, so there is nothing to escape and nothing
 * to get wrong.
 */
export async function readBundleBase64(bundleId: string): Promise<string> {
  return bundleFile(bundleId).base64();
}

/** Remove a bundle from the device, e.g. when its server is removed. */
export function deleteBundle(bundleId: string): void {
  try {
    const file = bundleFile(bundleId);
    if (file.exists) file.delete();
  } catch {
    // Already gone is the desired end state.
  }
}
