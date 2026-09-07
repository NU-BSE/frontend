/**
 * The legacy `expo-file-system` surface, which the download path uses for
 * `createDownloadResumable` — the only API that writes bytes natively and
 * reports a number, instead of carrying a gigabyte through the JS heap.
 *
 * Nothing here downloads. `verifyInstalled` never touches this module, and
 * these checks never start a transfer; it exists so the bundle resolves.
 */
export function createDownloadResumable(): never {
  throw new Error('the legacy download API is not exercised by these checks');
}
