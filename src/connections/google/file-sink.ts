import type { GoogleFileSink } from '@mobile-agent/connector-google';

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return cleaned || 'download';
}

/**
 * Writes downloaded Google Drive bytes to the app cache directory and returns
 * a `file://...` URI. The connector package stays platform-neutral; this is the
 * Expo/Android implementation.
 *
 * `expo-file-system` is loaded lazily so this module is safe to import in Node
 * verification scripts.
 */
export function createGoogleFileSink(): GoogleFileSink | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    return {
      async saveFile({ fileName, bytes }) {
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}-${sanitizeFileName(fileName)}`;
        const file = new File(Paths.cache, unique);
        file.create({ intermediates: true, overwrite: true });
        file.write(bytes);
        return { localUri: file.uri };
      },
    };
  } catch {
    return null;
  }
}
