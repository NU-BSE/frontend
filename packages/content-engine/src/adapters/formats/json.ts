import type { BinaryDocument } from '../../contracts/binary-document';
import type { DocumentFormatAdapter } from '../../contracts/adapters';

import { decodeText, looksLikeText } from './shared/decode-text';
import { TextDerivedAdapter } from './shared/text-adapter-base';
import type { TextPiece } from './shared/chunking';

export interface JsonFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'json';
}

/**
 * JSON, split at its top level.
 *
 * An array becomes one piece per element and an object one piece per key, so
 * a 20MB export of 50,000 records reads as records rather than as one string
 * the model cannot hold. Each piece keeps the parsed value in `structured`
 * alongside its text, because a caller asking about JSON usually wants the
 * value, not a re-parse of the excerpt.
 *
 * Only the top level is split. Descending further would produce pieces whose
 * meaning depends on ancestors that are no longer attached, and the location
 * path already lets a caller ask for a deeper region by name.
 *
 * JSONL (one object per line) is detected and handled too — it is what most
 * log and dataset exports actually are, and `JSON.parse` rejects it outright.
 */
export class JsonAdapter extends TextDerivedAdapter implements JsonFormatAdapter {
  readonly id = 'json' as const;

  async detect(input: BinaryDocument): Promise<boolean> {
    if (!looksLikeText(input.bytes)) return false;
    const name = input.fileName?.toLowerCase() ?? '';
    if (name.endsWith('.json') || name.endsWith('.jsonl') || name.endsWith('.ndjson')) {
      return true;
    }
    if (input.mimeType?.includes('json')) return true;
    const head = decodeText(input.bytes.slice(0, 512)).trimStart();
    return head.startsWith('{') || head.startsWith('[');
  }

  protected parse(input: BinaryDocument): readonly TextPiece[] {
    const text = decodeText(input.bytes).trim();
    if (!text) return [];

    const whole = tryParse(text);
    if (whole.ok) return piecesFromValue(whole.value);

    const lines = parseJsonLines(text);
    if (lines) {
      return lines.map((value, index) => ({
        text: stringify(value),
        structured: value,
        location: { paragraphId: `line:${index + 1}`, range: `line:${index + 1}` },
      }));
    }

    /*
     * Unparseable. The bytes are still returned as text rather than throwing:
     * a truncated or hand-edited JSON file is exactly the case where a user
     * wants to look at the content, and refusing to read it helps nobody.
     */
    return [{ text, location: { paragraphId: 'raw' } }];
  }

  protected summarize(
    pieces: readonly TextPiece[],
    input: BinaryDocument,
  ): Readonly<Record<string, unknown>> {
    const text = decodeText(input.bytes).trim();
    const parsed = tryParse(text);
    if (!parsed.ok) {
      return { valid: false, entries: pieces.length, shape: parseJsonLines(text) ? 'jsonl' : 'invalid' };
    }
    const value = parsed.value;
    return {
      valid: true,
      shape: Array.isArray(value) ? 'array' : typeof value,
      entries: pieces.length,
      ...(Array.isArray(value)
        ? {}
        : value !== null && typeof value === 'object'
          ? { keys: Object.keys(value as Record<string, unknown>).slice(0, 100) }
          : {}),
    };
  }
}

type ParseOutcome = { ok: true; value: unknown } | { ok: false };

function tryParse(text: string): ParseOutcome {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Every non-blank line parses on its own, and there are at least two. */
function parseJsonLines(text: string): unknown[] | null {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== '');
  if (lines.length < 2) return null;
  const values: unknown[] = [];
  for (const line of lines) {
    const parsed = tryParse(line.trim());
    if (!parsed.ok) return null;
    values.push(parsed.value);
  }
  return values;
}

function piecesFromValue(value: unknown): TextPiece[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => ({
      text: stringify(entry),
      structured: entry,
      location: { paragraphId: `[${index}]`, range: `$[${index}]` },
    }));
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, entry]) => ({
      text: `${key}: ${stringify(entry)}`,
      structured: { [key]: entry },
      location: { paragraphId: key, heading: key, headingPath: [key], range: `$.${key}` },
    }));
  }

  return [{ text: stringify(value), structured: value, location: { paragraphId: 'value' } }];
}

/** Pretty-printed, because the text is read by a model and by a person. */
function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    // Circular structures cannot occur in parsed JSON, but a caller may pass
    // a value from elsewhere.
    return String(value);
  }
}
