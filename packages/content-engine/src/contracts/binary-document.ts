/**
 * The canonical binary boundary of a document.
 *
 * Based on `Uint8Array` so it is identical across React Native / Hermes,
 * browsers, Node backends and Web Workers. A Node-only `Buffer` may exist only
 * inside a concrete adapter/processor or in Node-specific tooling/tests —
 * never in these core contracts.
 */
export interface BinaryDocument {
  bytes: Uint8Array;
  fileName?: string;
  mimeType?: string;
}
