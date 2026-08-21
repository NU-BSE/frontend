/**
 * Bytes to text, without depending on TextDecoder.
 *
 * Hermes ships no TextDecoder on every React Native version this runs on, and
 * a polyfill would be one more thing to keep loaded for the whole app. The
 * decoder below is small and total: it never throws on malformed input, it
 * substitutes U+FFFD the way a lenient decoder does, so a corrupt byte in a
 * 40MB file costs one replacement character rather than the whole read.
 */

/** What a leading byte-order mark says the encoding is. */
type Bom = { encoding: 'utf-8' | 'utf-16le' | 'utf-16be'; length: number };

function sniffBom(bytes: Uint8Array): Bom | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', length: 3 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', length: 2 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', length: 2 };
  }
  return null;
}

const REPLACEMENT = '�';

/*
 * Appending to a string in a tight loop is what makes naive decoders quadratic
 * in Hermes. Code units are collected in a fixed-size buffer and flushed
 * through String.fromCharCode, which keeps the cost linear.
 */
const FLUSH_AT = 4096;

function flush(units: number[], out: string[]): void {
  if (units.length === 0) return;
  out.push(String.fromCharCode(...units));
  units.length = 0;
}

function decodeUtf8(bytes: Uint8Array, start: number): string {
  const out: string[] = [];
  const units: number[] = [];
  let i = start;

  while (i < bytes.length) {
    const byte = bytes[i]!;
    let codePoint: number;
    let width: number;

    if (byte < 0x80) {
      codePoint = byte;
      width = 1;
    } else if ((byte & 0xe0) === 0xc0) {
      codePoint = byte & 0x1f;
      width = 2;
    } else if ((byte & 0xf0) === 0xe0) {
      codePoint = byte & 0x0f;
      width = 3;
    } else if ((byte & 0xf8) === 0xf0) {
      codePoint = byte & 0x07;
      width = 4;
    } else {
      // A stray continuation byte or an invalid lead.
      units.push(0xfffd);
      i += 1;
      if (units.length >= FLUSH_AT) flush(units, out);
      continue;
    }

    if (i + width > bytes.length) {
      // Truncated sequence at the end of the buffer.
      units.push(0xfffd);
      break;
    }

    let valid = true;
    for (let k = 1; k < width; k += 1) {
      const cont = bytes[i + k]!;
      if ((cont & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      codePoint = (codePoint << 6) | (cont & 0x3f);
    }

    if (!valid) {
      units.push(0xfffd);
      i += 1;
      if (units.length >= FLUSH_AT) flush(units, out);
      continue;
    }

    i += width;

    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      // Surrogates and out-of-range values are not encodable text.
      units.push(0xfffd);
    } else if (codePoint > 0xffff) {
      const adjusted = codePoint - 0x10000;
      units.push(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
    } else {
      units.push(codePoint);
    }

    if (units.length >= FLUSH_AT) flush(units, out);
  }

  flush(units, out);
  return out.join('');
}

function decodeUtf16(bytes: Uint8Array, start: number, littleEndian: boolean): string {
  const out: string[] = [];
  const units: number[] = [];
  for (let i = start; i + 1 < bytes.length; i += 2) {
    const a = bytes[i]!;
    const b = bytes[i + 1]!;
    units.push(littleEndian ? a | (b << 8) : (a << 8) | b);
    if (units.length >= FLUSH_AT) flush(units, out);
  }
  flush(units, out);
  return out.join('');
}

/**
 * Decodes a text payload, honouring a BOM when one is present.
 *
 * Without a BOM the bytes are read as UTF-8, which is also correct for ASCII
 * and for the Latin-1 subset that overlaps it. A legacy single-byte encoding
 * is not guessed: silently mis-decoding Cyrillic or Kazakh text into plausible
 * mojibake is worse than the replacement characters that UTF-8 decoding
 * produces, because mojibake reads as real content downstream.
 */
export function decodeText(bytes: Uint8Array): string {
  const bom = sniffBom(bytes);
  if (bom?.encoding === 'utf-16le') return decodeUtf16(bytes, bom.length, true);
  if (bom?.encoding === 'utf-16be') return decodeUtf16(bytes, bom.length, false);
  return decodeUtf8(bytes, bom ? bom.length : 0);
}

/**
 * Whether the bytes look like text rather than an opaque binary payload.
 *
 * Used by `detect` on the text-ish adapters, which have no magic number to
 * check. A NUL byte in the first block is the practical discriminator: real
 * text does not contain one, and every binary container this engine handles
 * (zip, PDF, PNG, JPEG) does within the first few hundred bytes.
 */
export function looksLikeText(bytes: Uint8Array, sampleSize = 1024): boolean {
  if (bytes.length === 0) return true;
  if (sniffBom(bytes)) return true;
  const end = Math.min(bytes.length, sampleSize);
  for (let i = 0; i < end; i += 1) {
    if (bytes[i] === 0) return false;
  }
  return true;
}
