import type { BinaryDocument } from '../../contracts/binary-document';
import type { DocumentFormatAdapter } from '../../contracts/adapters';

import { decodeText, looksLikeText } from './shared/decode-text';
import { TextDerivedAdapter } from './shared/text-adapter-base';
import type { TextPiece } from './shared/chunking';

export interface MarkdownFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'markdown';
}

const ATX_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/u;
const FENCE = /^\s{0,3}(```|~~~)/u;

/**
 * Markdown, kept as headings and the prose beneath them.
 *
 * Only the heading structure is interpreted. That is what `headingPath` needs
 * in order to answer "read section 3.2", and it is the part a reader navigates
 * by; inline emphasis and links are left in the text because stripping them
 * loses information the model can use and gains nothing measurable.
 *
 * Fenced code blocks are tracked so a `#` comment inside a shell snippet is
 * not mistaken for a heading — the single most common way naive Markdown
 * splitters invent structure that is not there.
 */
export class MarkdownAdapter extends TextDerivedAdapter implements MarkdownFormatAdapter {
  readonly id = 'markdown' as const;

  async detect(input: BinaryDocument): Promise<boolean> {
    if (!looksLikeText(input.bytes)) return false;
    const name = input.fileName?.toLowerCase() ?? '';
    if (name.endsWith('.md') || name.endsWith('.markdown')) return true;
    if (input.mimeType?.includes('markdown')) return true;
    // Fall back to content: a heading or a fence in the first lines.
    const head = decodeText(input.bytes.slice(0, 2048));
    return head.split(/\r?\n/u).some((line) => ATX_HEADING.test(line) || FENCE.test(line));
  }

  protected parse(input: BinaryDocument): readonly TextPiece[] {
    const lines = decodeText(input.bytes).split(/\r?\n/u);
    const pieces: TextPiece[] = [];
    const path: string[] = [];
    let buffer: string[] = [];
    let fence: string | null = null;
    let paragraph = 0;

    const flush = (): void => {
      const text = buffer.join('\n').trim();
      buffer = [];
      if (!text) return;
      pieces.push({
        text,
        location: {
          paragraphId: `p${paragraph}`,
          ...(path.length > 0 ? { headingPath: [...path] } : {}),
        },
      });
      paragraph += 1;
    };

    for (const line of lines) {
      const fenceMatch = FENCE.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1]!;
        if (fence === null) fence = marker;
        else if (fence === marker) fence = null;
        buffer.push(line);
        continue;
      }
      if (fence !== null) {
        buffer.push(line);
        continue;
      }

      const heading = ATX_HEADING.exec(line);
      if (heading) {
        flush();
        const depth = heading[1]!.length;
        const title = heading[2]!.trim();
        // Trim the path back to the parent of this depth before pushing, so a
        // jump from #### straight to ## does not leave stale ancestors behind.
        path.length = Math.min(path.length, depth - 1);
        path[depth - 1] = title;
        pieces.push({
          text: title,
          location: { heading: title, headingPath: [...path], paragraphId: `h${paragraph}` },
        });
        paragraph += 1;
        continue;
      }

      buffer.push(line);
    }
    flush();
    return pieces;
  }

  protected summarize(pieces: readonly TextPiece[]): Readonly<Record<string, unknown>> {
    const headings = pieces
      .filter((piece) => piece.location.heading !== undefined)
      .map((piece) => ({
        heading: piece.location.heading!,
        depth: piece.location.headingPath?.length ?? 1,
      }));
    return { headings };
  }
}
