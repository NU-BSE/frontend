import type { BinaryDocument } from '../../contracts/binary-document';
import type { DocumentFormatAdapter } from '../../contracts/adapters';

import { decodeText, looksLikeText } from './shared/decode-text';
import { TextDerivedAdapter } from './shared/text-adapter-base';
import type { TextPiece } from './shared/chunking';

export interface TextFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'text';
}

/**
 * Plain text.
 *
 * Paragraphs are separated by a blank line, which is the only structure plain
 * text carries. A file with no blank lines is one paragraph, and the chunker
 * bounds it — so a 5MB log still reads in pages rather than arriving whole.
 */
export class TextAdapter extends TextDerivedAdapter implements TextFormatAdapter {
  readonly id = 'text' as const;

  async detect(input: BinaryDocument): Promise<boolean> {
    return looksLikeText(input.bytes);
  }

  protected parse(input: BinaryDocument): readonly TextPiece[] {
    const text = decodeText(input.bytes);
    const pieces: TextPiece[] = [];
    // Split on blank lines, tolerating CRLF and trailing whitespace on the
    // blank line itself, which is common in files touched by Windows editors.
    const blocks = text.split(/\r?\n[ \t]*\r?\n/u);
    let offset = 0;
    blocks.forEach((block, index) => {
      const trimmed = block.trim();
      if (trimmed) {
        pieces.push({
          text: trimmed,
          location: { paragraphId: `p${index}`, range: `${offset}` },
        });
      }
      offset += block.length;
    });
    return pieces;
  }

  protected summarize(pieces: readonly TextPiece[]): Readonly<Record<string, unknown>> {
    return { paragraphs: pieces.length };
  }
}
