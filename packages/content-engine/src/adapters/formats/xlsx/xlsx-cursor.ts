import type { XlsxCursorState, XlsxSearchCursorState } from './xlsx-types';

/**
 * Opaque, deterministic cursor codec.
 *
 * Cursors are base64url-encoded JSON over UTF-8 so they survive any string
 * boundary (MCP, JSON, logs) without depending on `btoa`/`TextEncoder`, which
 * are not reliably present on React Native / Hermes. They carry only
 * structural positions — never cell content.
 */

const CURSOR_VERSION = 1;

function utf8Encode(input: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        i += 1;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] ?? 0;
    i += 1;
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b < 0xe0) {
      const b2 = bytes[i] ?? 0;
      i += 1;
      out += String.fromCharCode(((b & 0x1f) << 6) | (b2 & 0x3f));
    } else if (b < 0xf0) {
      const b2 = bytes[i] ?? 0;
      const b3 = bytes[i + 1] ?? 0;
      i += 2;
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f),
      );
    } else {
      const b2 = bytes[i] ?? 0;
      const b3 = bytes[i + 1] ?? 0;
      const b4 = bytes[i + 2] ?? 0;
      i += 3;
      const cp =
        ((b & 0x07) << 18) |
        ((b2 & 0x3f) << 12) |
        ((b3 & 0x3f) << 6) |
        (b4 & 0x3f);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    out += B64_ALPHABET.charAt(b0 >> 2);
    out += B64_ALPHABET.charAt(((b0 & 0x03) << 4) | (b1 >> 4));
    if (i + 1 < bytes.length) {
      out += B64_ALPHABET.charAt(((b1 & 0x0f) << 2) | (b2 >> 6));
    } else {
      out += '=';
    }
    if (i + 2 < bytes.length) {
      out += B64_ALPHABET.charAt(b2 & 0x3f);
    } else {
      out += '=';
    }
  }
  return out;
}

function base64UrlDecode(input: string): Uint8Array | null {
  const clean = input.replace(/=+$/u, '');
  if (!/^[A-Za-z0-9_-]*$/u.test(clean)) return null;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const ca = clean.charAt(i);
    const cb = clean.charAt(i + 1);
    const cc = clean.charAt(i + 2);
    const cd = clean.charAt(i + 3);
    const a = ca === '' ? -1 : B64_ALPHABET.indexOf(ca);
    const b = cb === '' ? -1 : B64_ALPHABET.indexOf(cb);
    const c = cc === '' ? -1 : B64_ALPHABET.indexOf(cc);
    const d = cd === '' ? -1 : B64_ALPHABET.indexOf(cd);
    if (a < 0 || b < 0) return null;
    bytes.push((a << 2) | (b >> 4));
    if (c >= 0) bytes.push(((b & 0x0f) << 4) | (c >> 2));
    if (d >= 0) bytes.push(((c & 0x03) << 6) | d);
  }
  return Uint8Array.from(bytes);
}

export function encodeCursor(state: XlsxCursorState): string {
  return base64UrlEncode(utf8Encode(JSON.stringify(state)));
}

export function decodeCursor(cursor: string): XlsxCursorState | null {
  if (typeof cursor !== 'string' || cursor.length === 0) return null;
  const bytes = base64UrlDecode(cursor);
  if (!bytes) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(utf8Decode(bytes));
  } catch {
    return null;
  }
  return validateCursorShape(raw);
}

function validateCursorShape(raw: unknown): XlsxCursorState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== CURSOR_VERSION) return null;
  if (typeof r.sheetName !== 'string') return null;
  for (const key of [
    'sheetIndex',
    'nextRow',
    'endRow',
    'startColumn',
    'endColumn',
    'finalSheetIndex',
  ] as const) {
    if (typeof r[key] !== 'number' || !Number.isInteger(r[key]) || (r[key] as number) < 0) {
      return null;
    }
  }
  const state: XlsxCursorState = {
    version: CURSOR_VERSION,
    sheetName: r.sheetName,
    sheetIndex: r.sheetIndex as number,
    nextRow: r.nextRow as number,
    endRow: r.endRow as number,
    startColumn: r.startColumn as number,
    endColumn: r.endColumn as number,
    finalSheetIndex: r.finalSheetIndex as number,
  };
  if (state.startColumn > state.endColumn || state.nextRow > state.endRow) {
    return null;
  }
  if (state.sheetIndex >= state.finalSheetIndex) return null;
  return state;
}

export function encodeSearchCursor(state: XlsxSearchCursorState): string {
  return base64UrlEncode(utf8Encode(JSON.stringify(state)));
}

export function decodeSearchCursor(token: string): XlsxSearchCursorState | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const bytes = base64UrlDecode(token);
  if (!bytes) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(utf8Decode(bytes));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== CURSOR_VERSION) return null;
  if (
    typeof r.sheetIndex !== 'number' ||
    !Number.isInteger(r.sheetIndex) ||
    r.sheetIndex < 0
  ) {
    return null;
  }
  if (
    typeof r.cellIndex !== 'number' ||
    !Number.isInteger(r.cellIndex) ||
    r.cellIndex < 0
  ) {
    return null;
  }
  return { version: CURSOR_VERSION, sheetIndex: r.sheetIndex, cellIndex: r.cellIndex };
}
