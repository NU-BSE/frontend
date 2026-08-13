/**
 * Download sink. The connector package is platform-neutral and never touches
 * `fs` or Expo filesystem APIs: the app layer injects a writer that persists
 * file bytes and returns a `file://...` URI.
 */
export interface GoogleFileSink {
  saveFile(input: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<{ localUri: string }>;
}
