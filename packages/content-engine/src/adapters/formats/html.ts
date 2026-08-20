import type { BinaryDocument } from '../../contracts/binary-document';
import type { DocumentFormatAdapter } from '../../contracts/adapters';

import { decodeText, looksLikeText } from './shared/decode-text';
import { TextDerivedAdapter } from './shared/text-adapter-base';
import type { TextPiece } from './shared/chunking';

export interface HtmlFormatAdapter extends DocumentFormatAdapter {
  readonly id: 'html';
}

/*
 * Elements whose contents are not prose. Their text is dropped entirely rather
 * than stripped of tags: a page's inline <script> is often larger than its
 * article, and letting it through produces chunks of minified JavaScript that
 * look like content to everything downstream.
 */
const DROPPED = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head']);

/** Elements that end the current text block. */
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside',
  'ul', 'ol', 'li', 'table', 'tr', 'blockquote', 'pre', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

/**
 * HTML reduced to its readable text, keeping the heading outline.
 *
 * A hand-written scanner rather than a DOM library: React Native has no DOM,
 * and pulling in a parser for what amounts to "find the text between the
 * tags" would be a large dependency for a small job. The scanner tracks only
 * what changes the output — which elements to skip, where blocks end, and the
 * heading depth — so it degrades on malformed markup by producing slightly
 * wrong block boundaries rather than by failing.
 *
 * The tradeoff is that this cannot honour CSS-driven visibility or rendered
 * order. For extracting the content of a saved page or an email body, which is
 * what arrives here, it is sufficient.
 */
export class HtmlAdapter extends TextDerivedAdapter implements HtmlFormatAdapter {
  readonly id = 'html' as const;

  async detect(input: BinaryDocument): Promise<boolean> {
    if (!looksLikeText(input.bytes)) return false;
    const name = input.fileName?.toLowerCase() ?? '';
    if (name.endsWith('.html') || name.endsWith('.htm') || name.endsWith('.xhtml')) return true;
    if (input.mimeType?.includes('html')) return true;
    const head = decodeText(input.bytes.slice(0, 2048)).toLowerCase();
    return head.includes('<!doctype html') || head.includes('<html') || head.includes('<body');
  }

  protected parse(input: BinaryDocument): readonly TextPiece[] {
    return extractHtmlPieces(decodeText(input.bytes));
  }

  protected summarize(pieces: readonly TextPiece[]): Readonly<Record<string, unknown>> {
    return {
      headings: pieces
        .filter((piece) => piece.location.heading !== undefined)
        .map((piece) => piece.location.heading!),
      blocks: pieces.length,
    };
  }
}

/** Exported for the verification script, which checks the scanner directly. */
export function extractHtmlPieces(html: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  const path: string[] = [];
  let buffer: string[] = [];
  let index = 0;
  let paragraph = 0;
  let skipUntil: string | null = null;
  let headingDepth: number | null = null;

  const flush = (): void => {
    const text = collapse(buffer.join(''));
    buffer = [];
    if (!text) {
      headingDepth = null;
      return;
    }
    if (headingDepth !== null) {
      path.length = Math.min(path.length, headingDepth - 1);
      path[headingDepth - 1] = text;
      pieces.push({
        text,
        location: { heading: text, headingPath: [...path], paragraphId: `h${paragraph}` },
      });
      headingDepth = null;
    } else {
      pieces.push({
        text,
        location: {
          paragraphId: `p${paragraph}`,
          ...(path.length > 0 ? { headingPath: [...path] } : {}),
        },
      });
    }
    paragraph += 1;
  };

  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      if (!skipUntil) buffer.push(html.slice(index));
      break;
    }
    // Guarded by skipUntil: text is collected before the tag that follows it
    // is examined, so without this check the body of a <script> would be
    // buffered by the iteration that then notices we are skipping.
    if (lt > index && !skipUntil) buffer.push(html.slice(index, lt));

    // Comments and doctype/CDATA carry no text.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt);
      index = end === -1 ? html.length : end + 1;
      continue;
    }

    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      // An unterminated tag at EOF: treat the remainder as text.
      buffer.push(html.slice(lt));
      break;
    }

    const raw = html.slice(lt + 1, gt);
    const closing = raw.startsWith('/');
    const name = (closing ? raw.slice(1) : raw)
      .split(/[\s/>]/u)[0]!
      .toLowerCase();
    index = gt + 1;

    if (skipUntil) {
      if (closing && name === skipUntil) skipUntil = null;
      continue;
    }
    if (!closing && DROPPED.has(name)) {
      // Self-closing dropped elements never open a skip region.
      if (!raw.trimEnd().endsWith('/')) skipUntil = name;
      continue;
    }

    if (BLOCK.has(name)) {
      if (!closing && HEADINGS[name] !== undefined) {
        flush();
        headingDepth = HEADINGS[name]!;
      } else {
        flush();
      }
    }
  }
  flush();

  return pieces;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»',
};

/** Decodes entities and collapses runs of whitespace, the way rendering does. */
function collapse(text: string): string {
  const decoded = text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x') || body.startsWith('#X')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
  return decoded.replace(/\s+/gu, ' ').trim();
}
