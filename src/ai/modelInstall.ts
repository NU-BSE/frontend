/**
 * Downloading the on-device model, and remembering where it went.
 *
 * The weights are not in the APK and must not be: a gigabyte of model inside a
 * Play download is a gigabyte every user pays for, including the ones who
 * choose cloud inference and never run it. So the app ships without them and
 * fetches them from the backend when someone actually picks on-device.
 *
 * That makes this a *long* download over a mobile connection, which decides
 * the design: it streams to disk natively, reports progress, and resumes.
 *
 * The bytes never enter the JavaScript heap. An earlier version fetched 8 MB
 * ranges and wrote each `arrayBuffer()` to the file, which died with
 *
 *     OutOfMemoryError: Failed to allocate a 8388627 byte allocation with
 *     6475008 free bytes ... growth limit 268435456
 *
 * — the chunk, allocated as a direct ByteBuffer against a 256 MB heap, while
 * expo's fetch still held its own copy of the previous one. No chunk size
 * fixes that honestly: a JS-mediated download of 1.8 GB is a stream of large
 * allocations through a heap that is not sized for it, and shrinking the
 * chunks only lowers the odds.
 *
 * `createDownloadResumable` writes to the file from native code and reports
 * bytes written, so the peak JS allocation is a progress number. It comes from
 * `expo-file-system/legacy` because the current API has no progress callback
 * at all, and a gigabyte with no visible progress is indistinguishable from a
 * hang.
 *
 * Pausing yields opaque `resumeData` which is persisted, so a download stopped
 * — by the user, or by leaving the screen — resumes rather than restarting.
 *
 * Integrity is checked by size, not by hash — see `verifyInstalled`.
 */

import { getModelCatalog, modelFileUrl, type ModelFileEntry } from '@/api/client';
import { getToken } from '@/api/client';

const INSTALL_KEY = 'creepyim.model.install.v1';
const DIRECTORY = 'models';

/** Where a paused download's opaque resume token lives, keyed by file name. */
const RESUME_KEY_PREFIX = 'creepyim.model.resume.';

function fileSystem(): typeof import('expo-file-system') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-file-system') as typeof import('expo-file-system');
}

/**
 * The legacy module, for `createDownloadResumable`.
 *
 * The current API streams to disk but reports no progress, and a 1.8 GB
 * download with no visible progress is indistinguishable from a hang. This one
 * reports bytes written and can be paused and resumed, which is what a
 * download this size on a phone needs.
 */
function legacyFileSystem(): typeof import('expo-file-system/legacy') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
}

async function asyncStorage() {
  return (await import('@react-native-async-storage/async-storage')).default;
}

/** One downloaded file, with the length it is supposed to have. */
export interface InstalledFile {
  path: string;
  bytes: number;
  role: string;
}

export interface InstalledModel {
  profile: string;
  model: string;
  /** Absolute path to the weights, for llama.rn. */
  path: string;
  /** Absolute path to the vision projector, when the model has one. */
  projectorPath: string | null;
  /**
   * Every file, each with *its own* length.
   *
   * `bytes` below is the bundle total, which is the number to show a user
   * choosing whether to download. Verification needs the per-file lengths, and
   * conflating the two was a real bug: the total was compared against the
   * weights file alone, so a complete install failed its own check on every
   * launch and the engine silently fell back to the stub.
   */
  files: InstalledFile[];
  /** Total across every file, for display. */
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

/**
 * The two spellings of a location, and why both exist.
 *
 * llama.rn takes a plain absolute path; `expo-file-system` takes a URI. The
 * install record stores the plain path, because that is what is handed to
 * native inference, and every filesystem call has to convert on the way in.
 *
 * Skipping the conversion is not a soft failure. On Android the File class
 * ends at
 *
 *     class JavaFile(override val uri: Uri) : File(URI.create(uri.toString()))
 *
 * and `java.io.File(URI)` rejects a URI with no scheme outright. So
 * `new File('/data/user/0/…/model.gguf')` throws rather than reporting a
 * missing file — and `verifyInstalled` catches everything and answers
 * `false`, which reads as "not downloaded". A complete 1.1 GB install failed
 * its own check on every launch, the engine fell back to the stub, and the
 * account screen reported "The on-device model has not been downloaded yet"
 * to someone looking at the model they had just waited twenty minutes for.
 *
 * Idempotent, so a record already holding a URI is left alone.
 */
function fileUri(pathOrUri: string): string {
  return pathOrUri.startsWith('file://') ? pathOrUri : `file://${pathOrUri}`;
}

export async function getInstalledModel(): Promise<InstalledModel | null> {
  try {
    const raw = await (await asyncStorage()).getItem(INSTALL_KEY);
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

    if (install.files && install.files.length > 0) {
      return install.files.every((entry) => {
        const file = new File(fileUri(entry.path));
        return file.exists && file.size === entry.bytes;
      });
    }

    // A record written before per-file lengths existed. Its `bytes` is the
    // bundle total and cannot be compared against any single file, so this
    // falls back to existence — the download verified each length at the time
    // it finished, and discarding a working install to punish an old record
    // would cost the user the whole download again.
    const file = new File(fileUri(install.path));
    return file.exists && file.size > 0;
  } catch {
    return false;
  }
}

async function persist(install: InstalledModel): Promise<void> {
  await (await asyncStorage()).setItem(INSTALL_KEY, JSON.stringify(install));
}

export async function removeInstalledModel(): Promise<void> {
  const install = await getInstalledModel();
  if (install) {
    for (const path of [install.path, install.projectorPath]) {
      if (!path) continue;
      try {
        const { File } = fileSystem();
        const file = new File(fileUri(path));
        if (file.exists) file.delete();
      } catch {
        // Already gone is the desired end state.
      }
    }
  }
  const storage = await asyncStorage();
  await storage.removeItem(INSTALL_KEY);
  // Resume tokens too: they point at partial files that are now gone, and a
  // later download resuming against one would continue into nothing.
  const keys = await storage.getAllKeys();
  const stale = keys.filter((key) => key.startsWith(RESUME_KEY_PREFIX));
  if (stale.length > 0) await storage.multiRemove(stale);
}

/**
 * Download one file to disk, resuming a previous attempt when there is one.
 *
 * Nothing here reads the body: the native task writes it, and this only
 * watches the byte count. That is the whole point — see the note at the top of
 * this module about the heap.
 */
async function downloadFile(
  entry: ModelFileEntry,
  options: {
    onBytes: (receivedForThisFile: number) => void;
    signal: AbortSignal;
    token: string | null;
    registerTask: (task: { pause: () => Promise<void> }) => void;
  },
): Promise<string> {
  const { File } = fileSystem();
  const file = fileFor(entry.name);

  if (file.exists && file.size === entry.bytes) {
    // Already complete from an earlier run.
    options.onBytes(entry.bytes);
    return file.uri.replace(/^file:\/\//u, '');
  }

  const storage = await asyncStorage();
  const resumeKey = RESUME_KEY_PREFIX + entry.name;
  const savedResumeData = (await storage.getItem(resumeKey)) ?? undefined;

  // A partial file with no resume token cannot be continued — the token is
  // what the platform matches against the server's validator. Starting over is
  // the only correct option; keeping the fragment would splice two responses.
  if (file.exists && !savedResumeData) file.delete();

  const headers: Record<string, string> = {};
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const legacy = legacyFileSystem();
  const task = legacy.createDownloadResumable(
    modelFileUrl(entry.url),
    file.uri,
    { headers },
    (progress) => options.onBytes(progress.totalBytesWritten),
    savedResumeData,
  );

  let paused = false;
  options.registerTask({
    pause: async () => {
      paused = true;
      const state = await task.pauseAsync();
      // Persisted immediately: the token is the only way back to a partial
      // file, and losing it costs the whole download.
      if (state?.resumeData) await storage.setItem(resumeKey, state.resumeData);
    },
  });

  const result = savedResumeData
    ? await task.resumeAsync()
    : await task.downloadAsync();

  if (paused || options.signal.aborted) throw new DownloadCancelledError();

  if (!result) throw new DownloadCancelledError();
  if (result.status === 402) throw new SubscriptionRequiredError();
  if (result.status >= 300) {
    throw new Error(`The server returned ${result.status} for ${entry.name}.`);
  }

  // The download completed, so any resume token is spent.
  await storage.removeItem(resumeKey);

  const finished = new File(file.uri);
  if (finished.size !== entry.bytes) {
    finished.delete();
    throw new Error(
      `${entry.name} finished at ${finished.size} bytes but should be ${entry.bytes}.`,
    );
  }

  return finished.uri.replace(/^file:\/\//u, '');
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

  // Progress is per file from the native task, so completed files are carried
  // separately; adding deltas would drift as soon as one file resumed.
  let completedBytes = 0;
  let active: { pause: () => Promise<void> } | null = null;

  const onAbort = () => {
    void active?.pause();
  };
  options.signal.addEventListener('abort', onAbort);

  const paths: Record<string, string> = {};
  try {
    for (const entry of bundle.files) {
      const path = await downloadFile(entry, {
        token,
        signal: options.signal,
        registerTask: (task) => {
          active = task;
        },
        onBytes: (receivedForThisFile) => {
          const received = completedBytes + receivedForThisFile;
          options.onProgress({
            receivedBytes: received,
            totalBytes: bundle.totalBytes,
            currentFile: entry.name,
            fraction: bundle.totalBytes > 0 ? received / bundle.totalBytes : 0,
          });
        },
      });
      completedBytes += entry.bytes;
      active = null;
      paths[entry.role] = path;
    }
  } finally {
    options.signal.removeEventListener('abort', onAbort);
  }

  const weights = paths.weights;
  if (!weights) throw new Error('The bundle contained no weights file.');

  const install: InstalledModel = {
    profile: bundle.profile,
    model: bundle.model,
    path: weights,
    projectorPath: paths.projector ?? null,
    files: bundle.files.map((entry) => ({
      path: paths[entry.role] ?? '',
      bytes: entry.bytes,
      role: entry.role,
    })),
    bytes: bundle.totalBytes,
    installedAt: Date.now(),
  };
  await persist(install);
  return install;
}
