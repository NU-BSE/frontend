import type { ChatAttachment } from '@/agent/types';
import type {
  BinaryDocument,
  DocumentFormatAdapter,
  DocumentRef,
} from '@mobile-agent/content-engine';
import {
  CsvAdapter,
  HtmlAdapter,
  JsonAdapter,
  MarkdownAdapter,
  TextAdapter,
} from '@mobile-agent/content-engine';

/**
 * Reading an attachment's content on the device.
 *
 * The file is parsed here and its text goes into the message. Nothing is
 * uploaded: the bytes never leave the phone, which is the same promise the
 * app makes about the on-device model, and it is why an attachment works
 * offline and against a local model as well as a remote one.
 *
 * The order below matters. Detection is by content and filename, and several
 * adapters accept plain text, so the most specific formats are asked first and
 * `text` is the fallback that accepts anything readable.
 */
const ADAPTERS: DocumentFormatAdapter[] = [
  new MarkdownAdapter(),
  new CsvAdapter(),
  new JsonAdapter(),
  new HtmlAdapter(),
  new TextAdapter(),
];

/**
 * How much extracted text may enter a prompt.
 *
 * A 10MB Markdown file is a legal attachment and would be several million
 * tokens. Cutting here — and saying so — keeps a large file useful instead of
 * making the turn fail or silently costing a fortune.
 */
const MAX_PROMPT_CHARS = 20_000;

export type AttachmentTextOutcome =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'failed'; reason: string };

/** Kinds that cannot become text on this device. */
function unsupportedReason(attachment: ChatAttachment): string | null {
  if (attachment.kind === 'image') {
    return 'Creepy cannot read images yet.';
  }
  if (attachment.kind === 'audio' || attachment.kind === 'video') {
    return `Creepy cannot read ${attachment.kind} files.`;
  }
  return null;
}

async function readBytes(uri: string): Promise<Uint8Array> {
  // Required lazily so this module stays importable from the Node
  // verification scripts, where expo-file-system does not resolve.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File } = require('expo-file-system') as typeof import('expo-file-system');
  const buffer = await new File(uri).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Extracts an attachment's text, or explains why it cannot.
 *
 * Never throws: a failure here must not lose the message the user typed
 * alongside the file, so every outcome is a value the caller can render.
 */
export async function extractAttachmentText(
  attachment: ChatAttachment,
): Promise<AttachmentTextOutcome> {
  const unsupported = unsupportedReason(attachment);
  if (unsupported) return { kind: 'unsupported', reason: unsupported };

  if (!attachment.uri) {
    return { kind: 'failed', reason: 'This attachment has no local file to read.' };
  }

  let input: BinaryDocument;
  try {
    input = {
      bytes: await readBytes(attachment.uri),
      fileName: attachment.name,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    };
  } catch {
    return { kind: 'failed', reason: `Could not read ${attachment.name}.` };
  }

  const document: DocumentRef = {
    id: attachment.id,
    source: 'local',
    name: attachment.name,
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
  };

  for (const adapter of ADAPTERS) {
    let matches = false;
    try {
      matches = await adapter.detect(input);
    } catch {
      continue;
    }
    if (!matches) continue;

    try {
      const parts: string[] = [];
      let total = 0;
      let cursor: string | undefined;
      let truncated = false;

      // Read through the cursor rather than in one call: the adapters bound a
      // single read, so a long file arrives in pages and stopping early is how
      // the character budget is enforced.
      do {
        const result = await adapter.read(
          document,
          input,
          cursor ? { kind: 'cursor', cursor } : { kind: 'all' },
        );
        for (const chunk of result.chunks) {
          const text = chunk.text ?? '';
          if (!text) continue;
          if (total + text.length > MAX_PROMPT_CHARS) {
            parts.push(text.slice(0, Math.max(0, MAX_PROMPT_CHARS - total)));
            total = MAX_PROMPT_CHARS;
            truncated = true;
            break;
          }
          parts.push(text);
          total += text.length;
        }
        cursor = truncated ? undefined : result.cursor;
        if (result.truncated && !cursor) truncated = true;
      } while (cursor && total < MAX_PROMPT_CHARS);

      const text = parts.join('\n').trim();
      if (!text) {
        return { kind: 'failed', reason: `${attachment.name} appears to be empty.` };
      }
      return { kind: 'text', text, truncated };
    } catch {
      return { kind: 'failed', reason: `Could not read ${attachment.name}.` };
    }
  }

  return {
    kind: 'unsupported',
    reason: `Creepy cannot read ${attachment.name} yet.`,
  };
}

/**
 * Builds the message text for a turn that carries attachments.
 *
 * Each file is fenced and labelled by name so the model can tell the user's
 * own words from the file's content, and can refer to a file by name when
 * several are attached. Files it could not read are stated rather than
 * omitted — silently dropping one would have the model answer about a
 * document it never saw.
 */
export function composeMessageWithAttachments(
  userText: string,
  files: readonly { name: string; outcome: AttachmentTextOutcome }[],
): string {
  const blocks: string[] = [];

  for (const { name, outcome } of files) {
    if (outcome.kind === 'text') {
      const note = outcome.truncated ? ' (truncated)' : '';
      blocks.push(`--- contents of ${name}${note} ---\n${outcome.text}\n--- end of ${name} ---`);
    } else {
      blocks.push(`--- ${name}: ${outcome.reason} ---`);
    }
  }

  const trimmed = userText.trim();
  if (blocks.length === 0) return trimmed;
  // The user's own words go last, closest to the model's turn, so a question
  // about the file is not buried above thousands of characters of it.
  return [...blocks, trimmed].filter(Boolean).join('\n\n');
}
