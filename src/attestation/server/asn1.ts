/**
 * Minimal, strict DER reader.
 *
 * The Android Key Description extension (OID 1.3.6.1.4.1.11129.2.1.17) is a
 * DER-encoded structure with context-specific EXPLICIT tags whose numbers reach
 * 724. Rather than fight a generic ASN.1 library over tag classes we decode the
 * bytes directly: every length is checked against the buffer, non-minimal and
 * indefinite lengths are rejected, and trailing bytes are reported. Anything the
 * parser cannot decode is a hard error — this is a security decoder, so
 * "best effort" is not an acceptable mode.
 */

export const TAG_CLASS_UNIVERSAL = 0x00;
export const TAG_CLASS_APPLICATION = 0x40;
export const TAG_CLASS_CONTEXT = 0x80;
export const TAG_CLASS_PRIVATE = 0xc0;

export const UNIVERSAL_BOOLEAN = 0x01;
export const UNIVERSAL_INTEGER = 0x02;
export const UNIVERSAL_BIT_STRING = 0x03;
export const UNIVERSAL_OCTET_STRING = 0x04;
export const UNIVERSAL_NULL = 0x05;
export const UNIVERSAL_OID = 0x06;
export const UNIVERSAL_ENUMERATED = 0x0a;
export const UNIVERSAL_SEQUENCE = 0x10;
export const UNIVERSAL_SET = 0x11;

export class Asn1Error extends Error {
  constructor(message: string) {
    super(`ASN.1 decode error: ${message}`);
    this.name = 'Asn1Error';
  }
}

export type Asn1Node = {
  /** One of the TAG_CLASS_* constants. */
  tagClass: number;
  /** Tag number within the class (context-specific tags can exceed 30). */
  tagNumber: number;
  constructed: boolean;
  /** Raw content octets (without the identifier/length header). */
  content: Buffer;
  /** Children, present only for constructed values. */
  children: Asn1Node[];
};

type ReadResult = { node: Asn1Node; nextOffset: number };

const readTagNumber = (
  buffer: Buffer,
  offset: number,
): { tagNumber: number; nextOffset: number } => {
  const first = buffer[offset];
  if (first === undefined) throw new Asn1Error('truncated identifier octet');
  const low = first & 0x1f;
  if (low !== 0x1f) return { tagNumber: low, nextOffset: offset + 1 };

  let cursor = offset + 1;
  let tagNumber = 0;
  for (;;) {
    const byte = buffer[cursor];
    if (byte === undefined) throw new Asn1Error('truncated high-tag-number form');
    tagNumber = tagNumber * 128 + (byte & 0x7f);
    cursor += 1;
    if ((byte & 0x80) === 0) break;
    if (tagNumber > 0xffffff) throw new Asn1Error('tag number is unreasonably large');
  }
  return { tagNumber, nextOffset: cursor };
};

const readLength = (
  buffer: Buffer,
  offset: number,
): { length: number; nextOffset: number } => {
  const first = buffer[offset];
  if (first === undefined) throw new Asn1Error('truncated length octet');
  if (first < 0x80) return { length: first, nextOffset: offset + 1 };
  if (first === 0x80) throw new Asn1Error('indefinite length is not valid DER');
  if (first === 0xff) throw new Asn1Error('reserved length octet 0xff');

  const byteCount = first & 0x7f;
  if (byteCount > 4) throw new Asn1Error('length exceeds 4 octets');
  let length = 0;
  for (let index = 0; index < byteCount; index += 1) {
    const byte = buffer[offset + 1 + index];
    if (byte === undefined) throw new Asn1Error('truncated long-form length');
    length = length * 256 + byte;
  }
  const firstLengthByte = buffer[offset + 1];
  if (firstLengthByte === 0x00) {
    throw new Asn1Error('non-minimal long-form length');
  }
  if (byteCount === 1 && length < 0x80) {
    throw new Asn1Error('long-form length used for a short value');
  }
  return { length, nextOffset: offset + 1 + byteCount };
};

const readNode = (buffer: Buffer, offset: number): ReadResult => {
  const identifier = buffer[offset];
  if (identifier === undefined) throw new Asn1Error('unexpected end of input');
  const tagClass = identifier & 0xc0;
  const constructed = (identifier & 0x20) !== 0;
  const { tagNumber, nextOffset: afterTag } = readTagNumber(buffer, offset);
  const { length, nextOffset: afterLength } = readLength(buffer, afterTag);
  const end = afterLength + length;
  if (end > buffer.length) {
    throw new Asn1Error(
      `declared length ${length} exceeds the remaining ${buffer.length - afterLength} bytes`,
    );
  }
  const content = buffer.subarray(afterLength, end);
  const children = constructed ? readSequence(content) : [];
  return {
    node: { tagClass, tagNumber, constructed, content, children },
    nextOffset: end,
  };
};

const readSequence = (buffer: Buffer): Asn1Node[] => {
  const nodes: Asn1Node[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const { node, nextOffset } = readNode(buffer, offset);
    nodes.push(node);
    offset = nextOffset;
  }
  return nodes;
};

/** Decodes exactly one DER value and rejects trailing bytes. */
export const decodeDer = (buffer: Buffer): Asn1Node => {
  const { node, nextOffset } = readNode(buffer, 0);
  if (nextOffset !== buffer.length) {
    throw new Asn1Error(
      `${buffer.length - nextOffset} trailing byte(s) after the top-level value`,
    );
  }
  return node;
};

export const isUniversal = (node: Asn1Node, tagNumber: number): boolean =>
  node.tagClass === TAG_CLASS_UNIVERSAL && node.tagNumber === tagNumber;

export const expectUniversal = (
  node: Asn1Node,
  tagNumber: number,
  label: string,
): Asn1Node => {
  if (!isUniversal(node, tagNumber)) {
    throw new Asn1Error(
      `${label}: expected universal tag ${tagNumber}, got class 0x${node.tagClass.toString(
        16,
      )} tag ${node.tagNumber}`,
    );
  }
  return node;
};

/** Reads an INTEGER / ENUMERATED as a JS number, rejecting oversized values. */
export const asInteger = (node: Asn1Node, label: string): number => {
  if (
    !isUniversal(node, UNIVERSAL_INTEGER) &&
    !isUniversal(node, UNIVERSAL_ENUMERATED)
  ) {
    throw new Asn1Error(`${label}: expected INTEGER or ENUMERATED`);
  }
  const bytes = node.content;
  if (bytes.length === 0) throw new Asn1Error(`${label}: empty INTEGER`);
  if (bytes.length > 6) {
    throw new Asn1Error(`${label}: INTEGER is too large to decode safely`);
  }
  const negative = (bytes[0]! & 0x80) !== 0;
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  if (!negative) return value;
  return value - 256 ** bytes.length;
};

export const asBoolean = (node: Asn1Node, label: string): boolean => {
  expectUniversal(node, UNIVERSAL_BOOLEAN, label);
  if (node.content.length !== 1) {
    throw new Asn1Error(`${label}: BOOLEAN must be exactly one octet`);
  }
  const byte = node.content[0]!;
  if (byte !== 0x00 && byte !== 0xff) {
    throw new Asn1Error(`${label}: BOOLEAN must be DER-encoded as 0x00 or 0xff`);
  }
  return byte === 0xff;
};

export const asOctetString = (node: Asn1Node, label: string): Buffer => {
  expectUniversal(node, UNIVERSAL_OCTET_STRING, label);
  return Buffer.from(node.content);
};

/** Decodes an OBJECT IDENTIFIER into its dotted-decimal form. */
export const asOid = (node: Asn1Node, label: string): string => {
  expectUniversal(node, UNIVERSAL_OID, label);
  const bytes = node.content;
  if (bytes.length === 0) throw new Asn1Error(`${label}: empty OID`);
  const first = bytes[0]!;
  const parts: number[] = [Math.min(Math.floor(first / 40), 2)];
  parts.push(first - parts[0]! * 40);
  let value = 0;
  let pending = false;
  for (let index = 1; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    value = value * 128 + (byte & 0x7f);
    pending = (byte & 0x80) !== 0;
    if (!pending) {
      parts.push(value);
      value = 0;
    }
  }
  if (pending) throw new Asn1Error(`${label}: truncated OID arc`);
  return parts.join('.');
};

/** Unwraps a constructed context-specific EXPLICIT tag to its single child. */
export const explicitChild = (node: Asn1Node, label: string): Asn1Node => {
  if (node.tagClass !== TAG_CLASS_CONTEXT || !node.constructed) {
    throw new Asn1Error(`${label}: expected a constructed context-specific tag`);
  }
  const [child, ...rest] = node.children;
  if (!child || rest.length > 0) {
    throw new Asn1Error(
      `${label}: EXPLICIT tag must wrap exactly one value, got ${node.children.length}`,
    );
  }
  return child;
};
