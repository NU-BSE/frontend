/**
 * Inline `**bold**` for assistant text.
 *
 * Models emit Markdown whether or not anything asked them to, and an
 * unrendered `**word**` reads as a glitch. This covers the one span type that
 * actually shows up in replies here; it is deliberately not a Markdown parser.
 *
 * Bold only, and for a concrete reason: emphasis has to be expressed as a
 * loaded font family rather than `fontWeight`, because Android does no
 * synthetic bolding and an unloaded weight silently renders as regular (see
 * src/components/Text.tsx). The app loads Lora at 400/600/700 and no italic
 * face at all, so `*italic*` could not be shown as italic — it would render
 * indistinguishably from body text while consuming its markers, which is
 * worse than leaving the asterisks visible.
 */

export interface InlineSegment {
  text: string;
  bold: boolean;
}

const MARKER = '**';

/**
 * Splits text into plain and bold runs.
 *
 * An unpaired or empty marker is content, not syntax: `2 ** 8` and a stray
 * trailing `**` stay exactly as the model wrote them. Only a marker with a
 * closing partner and something between them becomes emphasis.
 */
export function parseInlineBold(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let plain = '';
  let index = 0;

  const flushPlain = (): void => {
    if (plain) {
      segments.push({ text: plain, bold: false });
      plain = '';
    }
  };

  while (index < text.length) {
    const open = text.indexOf(MARKER, index);
    if (open === -1) break;

    const close = text.indexOf(MARKER, open + MARKER.length);
    if (close === -1) break;

    const inner = text.slice(open + MARKER.length, close);
    if (!inner) {
      // `****` — no content to emphasise, so both markers are literal.
      plain += text.slice(index, close + MARKER.length);
      index = close + MARKER.length;
      continue;
    }

    plain += text.slice(index, open);
    flushPlain();
    segments.push({ text: inner, bold: true });
    index = close + MARKER.length;
  }

  plain += text.slice(index);
  flushPlain();
  return segments;
}

/** Whether the text contains anything this renderer would style. */
export function hasInlineBold(text: string): boolean {
  return parseInlineBold(text).some((segment) => segment.bold);
}
