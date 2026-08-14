/**
 * MIME + encoding helpers for Gmail.
 *
 * Everything here is dependency-free and platform-neutral (runs in Node
 * verification scripts and in the app): base64/UTF-8 are implemented directly
 * so emoji, Cyrillic and Kazakh text round-trip exactly without relying on
 * `Buffer`/`atob`/`TextDecoder` availability.
 */

import type {
  GmailAttachment,
  GmailMessagePart,
  GmailMessagePartHeader,
} from './gmail-types';

// --- Base64 (standard + URL-safe) ------------------------------------------

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Value(charCode: number): number {
  if (charCode >= 65 && charCode <= 90) return charCode - 65; // A-Z
  if (charCode >= 97 && charCode <= 122) return charCode - 97 + 26; // a-z
  if (charCode >= 48 && charCode <= 57) return charCode - 48 + 52; // 0-9
  if (charCode === 43) return 62; // +
  if (charCode === 47) return 63; // /
  return -1;
}

export function encodeBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const c0 = bytes[i]!;
    const c1 = i + 1 < len ? bytes[i + 1]! : 0;
    const c2 = i + 2 < len ? bytes[i + 2]! : 0;
    const triple = (c0 << 16) | (c1 << 8) | c2;
    result += BASE64_CHARS[(triple >> 18) & 0x3f]!;
    result += BASE64_CHARS[(triple >> 12) & 0x3f]!;
    result += i + 1 < len ? BASE64_CHARS[(triple >> 6) & 0x3f]! : '=';
    result += i + 2 < len ? BASE64_CHARS[triple & 0x3f]! : '=';
  }
  return result;
}

export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const value = base64Value(clean.charCodeAt(i));
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Decodes Gmail's URL-safe, unpadded base64 (`body.data`, `message.raw`). */
export function decodeBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return decodeBase64(padded);
}

/** Encodes to URL-safe base64 without padding (Gmail `raw` format). */
export function encodeBase64Url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8Encode(input) : input;
  return encodeBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// --- UTF-8 -------------------------------------------------------------------

export function utf8Encode(value: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const code = value.codePointAt(i)!;
    if (code > 0xffff) i += 1; // consumed a surrogate pair
    if (code <= 0x7f) {
      out.push(code);
    } else if (code <= 0x7ff) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      out.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i]!;
    let code: number;
    let extra: number;
    if (b0 < 0x80) {
      code = b0;
      extra = 0;
    } else if ((b0 & 0xe0) === 0xc0) {
      code = b0 & 0x1f;
      extra = 1;
    } else if ((b0 & 0xf0) === 0xe0) {
      code = b0 & 0x0f;
      extra = 2;
    } else if ((b0 & 0xf8) === 0xf0) {
      code = b0 & 0x07;
      extra = 3;
    } else {
      code = 0xfffd;
      extra = 0;
    }
    for (let j = 1; j <= extra; j++) {
      const b = bytes[i + j];
      if (b !== undefined && (b & 0xc0) === 0x80) {
        code = (code << 6) | (b & 0x3f);
      } else {
        code = 0xfffd;
        extra = j - 1;
        break;
      }
    }
    i += extra + 1;
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) code = 0xfffd;
    out += String.fromCodePoint(code);
  }
  return out;
}

// --- Header helpers ----------------------------------------------------------

function encodeHeader(value: string): string {
  // ASCII-only headers pass through unchanged; anything else is RFC 2047
  // encoded-word UTF-8/B so the raw MIME stays 7-bit safe.
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${encodeBase64(utf8Encode(value))}?=`;
}

function decodeEncodedWords(value: string): string {
  return value.replace(/=\?[^?]+\?[BbQq]\?[^?]*\?=/g, (word) => {
    const match = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/.exec(word);
    if (!match) return word;
    const encoding = match[2]!.toUpperCase();
    if (encoding === 'B') {
      return utf8Decode(decodeBase64(match[3]!));
    }
    // Q-encoding: underscore → space, =XX → byte.
    const bytes: number[] = [];
    const q = match[3]!.replace(/_/g, ' ');
    for (let i = 0; i < q.length; i++) {
      if (q[i] === '=' && i + 2 < q.length) {
        bytes.push(parseInt(q.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(q.charCodeAt(i));
      }
    }
    return utf8Decode(Uint8Array.from(bytes));
  });
}

const EMAIL_RE = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/;

function extractEmail(value: string): string | undefined {
  return EMAIL_RE.exec(value)?.[1];
}

function parseAddressList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  // Split on commas that are not inside quotes.
  const parts = value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const emails: string[] = [];
  for (const part of parts) {
    const email = extractEmail(part.trim());
    if (email) emails.push(email);
  }
  return emails.length > 0 ? emails : undefined;
}

// --- HTML → text (safe) --------------------------------------------------------

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Turns HTML-only bodies into plain text. This is a lossy text extraction,
 * never a renderer: no script, iframe or remote resource can execute, because
 * the output is plain text only.
 */
export function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<head[\s\S]*?<\/head>/gi, ' ');
  text = text.replace(
    /<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/blockquote)[^>]*>/gi,
    '\n',
  );
  text = text.replace(/<(p|div|li|tr|h[1-6]|blockquote)[^>]*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeHtmlEntities(text);
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/ *\n */g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// --- MIME build ---------------------------------------------------------------

export interface BuildMimeMessageInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  textBody?: string;
  htmlBody?: string;
  inReplyTo?: string;
  references?: string;
}

function wrapBase64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

function singlePart(mimeType: string, content: string): string {
  const encoded = wrapBase64(encodeBase64(utf8Encode(content)));
  return [
    `Content-Type: ${mimeType}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    encoded,
  ].join('\r\n');
}

function multipartAlternative(text: string, html: string): string {
  const boundary = `boundary_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    singlePart('text/plain', text),
    `--${boundary}`,
    singlePart('text/html', html),
    `--${boundary}--`,
  ].join('\r\n');
}

/**
 * Builds an RFC 2822 / RFC 2045 message (without `From`; Gmail fills the
 * authenticated sender) ready to be base64url-encoded into `message.raw`.
 */
export function buildMimeMessage(input: BuildMimeMessageInput): string {
  const headers: string[] = ['MIME-Version: 1.0'];
  if (input.to.length > 0) headers.push(`To: ${input.to.join(', ')}`);
  if (input.cc && input.cc.length > 0) headers.push(`Cc: ${input.cc.join(', ')}`);
  if (input.bcc && input.bcc.length > 0) headers.push(`Bcc: ${input.bcc.join(', ')}`);
  headers.push(`Subject: ${encodeHeader(input.subject)}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headers.push(`References: ${input.references}`);

  const hasText = typeof input.textBody === 'string' && input.textBody.length > 0;
  const hasHtml = typeof input.htmlBody === 'string' && input.htmlBody.length > 0;

  let body: string;
  if (hasText && hasHtml) {
    body = multipartAlternative(input.textBody!, input.htmlBody!);
  } else if (hasHtml) {
    body = singlePart('text/html', input.htmlBody!);
  } else {
    body = singlePart('text/plain', hasText ? input.textBody! : '');
  }

  return `${headers.join('\r\n')}\r\n${body}`;
}

// --- MIME parse ----------------------------------------------------------------

export interface ParsedGmailPayload {
  subject?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  date?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  textBody?: string;
  htmlBody?: string;
  attachments: GmailAttachment[];
}

function headerMap(
  headers: GmailMessagePartHeader[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const header of headers ?? []) {
    const key = header.name.toLowerCase();
    if (!map.has(key)) map.set(key, header.value);
  }
  return map;
}

function isAttachment(part: GmailMessagePart): boolean {
  const mimeType = part.mimeType ?? '';
  const filename = part.filename;
  const hasAttachmentId = typeof part.body?.attachmentId === 'string';
  const namedBinary = typeof filename === 'string' && filename.length > 0;
  return hasAttachmentId || (namedBinary && !/^text\/(plain|html)$/.test(mimeType));
}

function walkParts(
  part: GmailMessagePart,
  sink: { textBody?: string; htmlBody?: string; attachments: GmailAttachment[] },
): void {
  if (part.parts && part.parts.length > 0) {
    for (const child of part.parts) walkParts(child, sink);
    return;
  }

  const mimeType = part.mimeType ?? '';
  const data = part.body?.data;

  if (mimeType === 'text/plain' && typeof data === 'string') {
    if (sink.textBody === undefined) {
      sink.textBody = utf8Decode(decodeBase64Url(data));
    }
    return;
  }

  if (mimeType === 'text/html' && typeof data === 'string') {
    if (sink.htmlBody === undefined) {
      sink.htmlBody = utf8Decode(decodeBase64Url(data));
    }
    return;
  }

  if (isAttachment(part)) {
    sink.attachments.push({
      ...(typeof part.body?.attachmentId === 'string'
        ? { attachmentId: part.body.attachmentId }
        : {}),
      filename:
        part.filename ?? `attachment-${part.partId ?? sink.attachments.length + 1}`,
      mimeType: mimeType || 'application/octet-stream',
      size: part.body?.size ?? 0,
    });
  }
}

/**
 * Recursively extracts text/plain, text/html and attachment metadata from a
 * Gmail message payload. Handles flat, multipart/alternative and
 * multipart/mixed trees. Attachment bodies are never fetched here.
 */
export function parseGmailPayload(
  payload: GmailMessagePart | undefined,
): ParsedGmailPayload {
  if (!payload) return { attachments: [] };

  const headers = headerMap(payload.headers);
  const sink: {
    textBody?: string;
    htmlBody?: string;
    attachments: GmailAttachment[];
  } = { attachments: [] };
  walkParts(payload, sink);

  const fromHeader = headers.get('from');
  const fromEmail = fromHeader ? extractEmail(decodeEncodedWords(fromHeader)) : undefined;
  const subject = headers.get('subject');
  const date = headers.get('date');
  const messageId = headers.get('message-id');
  const inReplyTo = headers.get('in-reply-to');
  const references = headers.get('references');

  return {
    ...(subject !== undefined ? { subject: decodeEncodedWords(subject) } : {}),
    ...(fromEmail ? { from: fromEmail } : {}),
    ...(() => {
      const to = parseAddressList(headers.get('to'));
      return to ? { to } : {};
    })(),
    ...(() => {
      const cc = parseAddressList(headers.get('cc'));
      return cc ? { cc } : {};
    })(),
    ...(() => {
      const bcc = parseAddressList(headers.get('bcc'));
      return bcc ? { bcc } : {};
    })(),
    ...(date !== undefined ? { date } : {}),
    ...(messageId !== undefined ? { messageId } : {}),
    ...(inReplyTo !== undefined ? { inReplyTo } : {}),
    ...(references !== undefined ? { references } : {}),
    ...(sink.textBody !== undefined ? { textBody: sink.textBody } : {}),
    ...(sink.htmlBody !== undefined ? { htmlBody: sink.htmlBody } : {}),
    attachments: sink.attachments,
  };
}

// --- Body / limits helpers -------------------------------------------------------

/** Truncates a body to `max` characters so the model never sees a mailbox. */
export function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

// --- Fingerprint ---------------------------------------------------------------

/**
 * Stable, dependency-free hash of a draft's raw MIME. `send_draft` recomputes
 * it from the freshly-fetched draft and compares, so a draft changed between
 * approval and send is refused. Not cryptographic — it detects accidental or
 * adversarial mutation between approval and execution, which is the TOCTOU
 * window the approval hash alone cannot cover (the draft lives server-side).
 */
export function computeRawFingerprint(raw: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `g${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Fingerprint over a draft's content fields (recipients, subject, bodies),
 * stable across the create/update → send round trip: Gmail normalizes the
 * stored raw MIME, so hashing the raw bytes would not match after a refetch.
 * Hashing the semantic content both survives normalization and still detects a
 * mutation (the TOCTOU window between approval and send).
 */
export function computeDraftFingerprint(input: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  textBody?: string;
  htmlBody?: string;
}): string {
  const canonical = JSON.stringify([
    input.to,
    input.cc ?? [],
    input.bcc ?? [],
    input.subject,
    input.textBody ?? '',
    input.htmlBody ?? '',
  ]);
  return computeRawFingerprint(canonical);
}
