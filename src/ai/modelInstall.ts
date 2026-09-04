/**
 * Downloading the on-device model, and remembering where it went.
 *
 * The weights are not in the APK and must not be: a gigabyte of model inside a
 * Play download is a gigabyte every user pays for, including the ones who
 * choose cloud inference and never run it. So the app ships without them and
 * fetches them from the backend when someone actually picks on-device.
 *
 * That makes this a *long* download over a mobile connection, which decides
 * the design:
 *
 * * **Chunked, with Range.** The backend supports Range because of this. A
 *   dropped connection at 900 MB resumes from 900 MB rather than starting
 *   again, and the progress a chunked loop reports is real rather than
 *   inferred.
 * * **Bytes, not base64.** `File.write` takes a Uint8Array, so a chunk goes
 *   from the socket to the file without a 33% base64 detour through a string.
 * * **Cancellable.** A user who started this on mobile data must be able to
 *   stop it, and stopping must leave the partial file resumable.
 *
 * Integrity is checked by size, not by hash — see `verifyInstalled`.
 */

import { getModelCatalog, modelFileUrl, type ModelFileEntry } from '@/api/client';
import { getToken } from '@/api/client';

const INSTALL_KEY = 'creepyim.model.install.v1';
const DIRECTORY = 'models';

/** 8 MB: large enough that per-chunk overhead is noise, small enough that a
 * dropped connection loses little and progress moves visibly. */
const CHUNK_BYTES = 8 * 1024 * 1024;

function fileSystem(): typeof import('expo-file-system') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-file-system') as typeof import('expo-file-system');
}

export interface InstalledModel {
  profile: string;
  model: string;
  /** Absolute path to the weights, for llama.rn. */
  path: string;
  /** Absolute path to the vision projector, when the model has one. */
  projectorPath: string | null;
  bytes: number;
  installedAt: number;
}

export interface DownloadProgress {
  /** Bytes on disk across every file in the bundle. */
  receivedBytes: number;
  totalBytes: number;
  /** The file being fetched right now. */
  currentFile: string;
  /** 0-1. */
  fraction: number;
}

export class DownloadCancelledError extends Error {
  constructor() {
    super('The download was stopped.');
    this.name = 'DownloadCancelledError';
  }
}

export class SubscriptionRequiredError extends Error {
  constructor() {
    super('An active subscription is required to download the model.');
    this.name = 'SubscriptionRequiredError';
  }
}

function modelsDirectory() {
  const { Directory, Paths } = fileSystem();
  // The document directory, not the cache: the system may delete a cached file
  // whenever it likes, and losing a gigabyte the user waited for — silently,
  // at a moment nobody chose — is not a tradeoff worth making for disk space.
  const directory = new Directory(Paths.document, DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

function fileFor(name: string) {
  const { File } = fileSystem();
  return new File(modelsDirectory(), name);
}

export async function getInstalledModel(): Promise<InstalledModel | null> {
  try {
    const AsyncStorage = (
      await import('@react-native-async-storage/async-storage')
    ).default;
    const raw = await AsyncStorage.getItem(INSTALL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InstalledModel;
    if (typeof parsed?.path !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Whether the recorded install is still real.
 *
 * The record is not trusted on its own: a user can clear app storage, and a
 * path that no longer exists would otherwise be handed to llama.rn, which
 * fails deep in native code with a message that names nothing useful.
 *
 * Size is checked; content is not. Hashing a 1.1 GB file in JavaScript on a
 * phone takes minutes, so a per-launch integrity check would cost more than
 * the failure it prevents. The bytes arrive over HTTPS and the exact length is
 * verified, which catches the realistic failure — a truncated download — and
 * not a hostile one.
 */
export async function verifyInstalled(install: InstalledModel): Promise<boolean> {
  try {
    const { File } = fileSystem();
    const file = new File(install.path);
    return file.exists && file.size === install.bytes;
  } catch {
    return false;
  }
}

async function persist(install: InstalledModel): Promise<void> {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem(INSTALL_KEY, JSON.stringify(install));
}

export async function removeInstalledModel(): Promise<void> {
  const install = await getInstalledModel();
  if (install) {
    for (const path of [install.path, install.projectorPath]) {
      if (!path) continue;
      try {
        const { File } = fileSystem();
        const file = new File(path);
        if (file.exists) file.delete();
      } catch {
        // Already gone is the desired end state.
      }
    }
  }
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.removeItem(INSTALL_KEY);
}

/** Download one file, resuming from whatever is already on disk. */
async function downloadFile(
  entry: ModelFileEntry,
  options: {
    onBytes: (delta: number) => void;
    signal: AbortSignal;
    token: string | null;
  },
): Promise<string> {
  const file = fileFor(entry.name);
  if (file.exists && file.size === entry.bytes) {
    // Already complete from an earlier run.
    options.onBytes(entry.bytes);
    return file.uri.replace(/^file:\/\//u, '');
  }

  if (file.exists && file.size > entry.bytes) {
    // Longer than it should be: the server's file changed under a partial
    // download. Resuming would splice two different models together.
    file.delete();
  }
  if (!file.exists) file.create();

  let received = file.size;
  options.onBytes(received);

  const headers: Record<string, string> = {};
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  while (received < entry.bytes) {
    if (options.signal.aborted) throw new DownloadCancelledError();

    const end = Math.min(received + CHUNK_BYTES, entry.bytes) - 1;
    const response = await fetch(modelFileUrl(entry.url), {
      headers: { ...headers, Range: `bytes=${received}-${end}` },
      signal: options.signal,
    });

    if (response.status === 402) throw new SubscriptionRequiredError();
    if (response.status !== 206 && response.status !== 200) {
      throw new Error(`The server returned ${response.status} for ${entry.name}.`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) {
      throw new Error(`The server sent no data for ${entry.name} at ${received} bytes.`);
    }

    file.write(bytes, { append: true });
    received += bytes.length;
    options.onBytes(bytes.length);
  }

  if (file.size !== entry.bytes) {
    file.delete();
    throw new Error(
      `${entry.name} finished at ${file.size} bytes but should be ${entry.bytes}.`,
    );
  }

  return file.uri.replace(/^file:\/\//u, '');
}

/**
 * Fetch the on-device bundle, reporting progress as it goes.
 *
 * Returns the install record; the caller persists nothing itself.
 */
export async function installModel(options: {
  profile: string;
  onProgress: (progress: DownloadProgress) => void;
  signal: AbortSignal;
}): Promise<InstalledModel> {
  const catalog = await getModelCatalog();
  const bundle = catalog.bundles.find((item) => item.profile === options.profile);
  if (!bundle) {
    throw new Error(`The server offers no weights for the ${options.profile} profile.`);
  }
  if (!catalog.downloadAllowed) throw new SubscriptionRequiredError();

  const token = await getToken();
  let received = 0;

  const paths: Record<string, string> = {};
  for (const entry of bundle.files) {
    const path = await downloadFile(entry, {
      token,
      signal: options.signal,
      onBytes: (delta) => {
        received += delta;
        options.onProgress({
          receivedBytes: received,
          totalBytes: bundle.totalBytes,
          currentFile: entry.name,
          fraction: bundle.totalBytes > 0 ? received / bundle.totalBytes : 0,
        });
      },
    });
    paths[entry.role] = path;
  }

  const weights = paths.weights;
  if (!weights) throw new Error('The bundle contained no weights file.');

  const install: InstalledModel = {
    profile: bundle.profile,
    model: bundle.model,
    path: weights,
    projectorPath: paths.projector ?? null,
    bytes: bundle.totalBytes,
    installedAt: Date.now(),
  };
  await persist(install);
  return install;
}
