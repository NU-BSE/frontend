/**
 * A stand-in for `expo-file-system` that copies the one behaviour this app
 * kept getting wrong: the File class is URI-based, and a scheme-less argument
 * is an error rather than a missing file.
 *
 * On Android the class bottoms out in
 *
 *     class JavaFile(override val uri: Uri) : File(URI.create(uri.toString()))
 *
 * and `java.io.File(URI)` throws IllegalArgumentException for a URI that is
 * not absolute. A stub that quietly reported `exists === false` for a bare
 * path would let the bug back in while every test passed, so this throws the
 * way the platform does.
 */

export interface StubEntry {
  size: number;
}

const slot = globalThis as { __fsFiles?: Map<string, StubEntry> };
slot.__fsFiles ??= new Map<string, StubEntry>();
const files = slot.__fsFiles;

function requireUri(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${where}: expected a URI string`);
  }
  if (!value.startsWith('file://')) {
    throw new Error(
      `IllegalArgumentException: URI is not absolute — ${value} (${where})`,
    );
  }
  return value;
}

export class Directory {
  readonly uri: string;

  constructor(parent: Directory | string, ...segments: string[]) {
    const base = typeof parent === 'string' ? parent : parent.uri;
    this.uri = [base.replace(/\/$/u, ''), ...segments].join('/');
  }

  get exists(): boolean {
    return true;
  }

  create(): void {
    // Directories are implicit in the map.
  }
}

export class File {
  readonly uri: string;

  constructor(parent: Directory | File | string, ...segments: string[]) {
    const base =
      typeof parent === 'string'
        ? requireUri(parent, 'new File(uri)')
        : parent.uri;
    this.uri = segments.length
      ? [base.replace(/\/$/u, ''), ...segments].join('/')
      : base;
  }

  get exists(): boolean {
    return files.has(this.uri);
  }

  get size(): number {
    return files.get(this.uri)?.size ?? 0;
  }

  delete(): void {
    files.delete(this.uri);
  }
}

export const Paths = { document: 'file:///documents', cache: 'file:///cache' };
