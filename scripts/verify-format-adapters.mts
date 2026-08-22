/**
 * Format adapter checks: text, markdown, csv, json, html.
 *
 * The risks these guard are the ones that produce a *plausible* wrong answer
 * rather than an error, because those are the ones that reach the model and
 * get treated as fact:
 *
 *   - a semicolon-separated export read as one column of garbage
 *   - a quoted CSV field containing a comma silently splitting into two
 *   - a `#` inside a shell snippet becoming a Markdown heading
 *   - a page's inline <script> arriving as if it were article text
 *   - a cursor that skips or repeats a piece when a read resumes
 *
 * Run: npm run verify:formats
 */
import { TextAdapter } from '../packages/content-engine/src/adapters/formats/text.js';
import { MarkdownAdapter } from '../packages/content-engine/src/adapters/formats/markdown.js';
import { CsvAdapter, parseDelimited, sniffDelimiter } from '../packages/content-engine/src/adapters/formats/csv.js';
import { JsonAdapter } from '../packages/content-engine/src/adapters/formats/json.js';
import { HtmlAdapter } from '../packages/content-engine/src/adapters/formats/html.js';
import { decodeText, looksLikeText } from '../packages/content-engine/src/adapters/formats/shared/decode-text.js';
import type { DocumentRef } from '../packages/content-engine/src/contracts/document-ref.js';
import type { BinaryDocument } from '../packages/content-engine/src/contracts/binary-document.js';

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  ok — ${message}`);
  } else {
    console.error(`  FAIL — ${message}`);
    failures += 1;
  }
}

const TAB = String.fromCharCode(9);

function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

function doc(name: string): DocumentRef {
  return { id: `doc-${name}`, source: 'google_drive', name };
}

function binary(text: string, fileName: string, mimeType?: string): BinaryDocument {
  return { bytes: utf8(text), fileName, ...(mimeType ? { mimeType } : {}) };
}

async function main(): Promise<void> {
  console.log('text decoding:');
  assert(decodeText(utf8('hello')) === 'hello', 'ascii round-trips');
  assert(decodeText(utf8('Привет, әлем')) === 'Привет, әлем', 'cyrillic and kazakh round-trip');
  assert(decodeText(utf8('emoji 🙂 tail')) === 'emoji 🙂 tail', 'astral plane round-trips');
  assert(
    decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x68, 0x69])) === 'hi',
    'utf-8 BOM is consumed, not emitted',
  );
  assert(
    decodeText(Uint8Array.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])) === 'hi',
    'utf-16le BOM decodes',
  );
  assert(
    decodeText(Uint8Array.from([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69])) === 'hi',
    'utf-16be BOM decodes',
  );
  const damaged = decodeText(Uint8Array.from([0x68, 0xff, 0x69]));
  assert(damaged.length === 3 && damaged.startsWith('h') && damaged.endsWith('i'),
    'an invalid byte costs one replacement char, not the whole string');
  assert(!looksLikeText(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00])), 'a zip is not text');
  assert(looksLikeText(utf8('plain')), 'plain text is text');

  console.log('\ncsv — delimiters and quoting:');
  assert(sniffDelimiter('a;b;c\n1;2;3') === ';', 'semicolon export detected');
  assert(sniffDelimiter('a,b,c\n1,2,3') === ',', 'comma export detected');
  assert(sniffDelimiter(`a${TAB}b${TAB}c\n1${TAB}2${TAB}3`) === TAB, 'tab export detected');
  /*
   * The discriminating case: commas appear inside fields but at differing
   * counts per row, so only the semicolon yields a consistent column count.
   * (A file where both delimiters happen to give the same consistent shape is
   * genuinely ambiguous and no sniffer can resolve it; that is not asserted.)
   */
  assert(
    sniffDelimiter('name;note\nИванов;директор, отдел продаж\nПетров;менеджер') === ';',
    'prose commas do not beat the real semicolon delimiter',
  );

  const quoted = parseDelimited('name,note\n"Smith, John","said ""hi"" loudly"\n', ',');
  assert(quoted.length === 2, 'quoted file has two rows');
  assert(quoted[1]![0] === 'Smith, John', 'a comma inside quotes stays in one field');
  assert(quoted[1]![1] === 'said "hi" loudly', 'doubled quotes unescape');

  const multiline = parseDelimited('a,b\n"line1\nline2",x\n', ',');
  assert(multiline.length === 2, 'a newline inside quotes does not split the row');
  assert(multiline[1]![0] === 'line1\nline2', 'the embedded newline is preserved');

  const crlf = parseDelimited('a,b\r\n1,2\r\n', ',');
  assert(crlf.length === 2 && crlf[1]![1] === '2', 'CRLF is one terminator, not two');
  assert(parseDelimited('a,b\n1,2\n', ',').length === 2, 'a trailing newline adds no phantom row');

  const csv = new CsvAdapter();
  const csvDoc = doc('report.csv');
  const csvBin = binary('name;city\nАйгуль;Алматы\nJohn;Astana\n', 'report.csv');
  assert(await csv.detect(csvBin), 'csv detected by extension');
  const csvRead = await csv.read(csvDoc, csvBin, { kind: 'all' });
  assert(csvRead.chunks.length === 2, 'header row is not returned as data');
  assert(
    JSON.stringify(csvRead.chunks[0]!.structured) === JSON.stringify({ name: 'Айгуль', city: 'Алматы' }),
    'row is labelled by header',
  );
  assert(csvRead.chunks[0]!.location.range === 'row:2', 'row number counts the header');
  assert(csvRead.chunks[0]!.kind === 'table', 'csv rows are table chunks');

  const headerless = await csv.read(doc('h.csv'), binary('1,2\n3,4\n', 'h.csv'), { kind: 'all' });
  assert(headerless.chunks.length === 2, 'a headerless file keeps its first record');

  console.log('\nmarkdown — headings and code fences:');
  const md = new MarkdownAdapter();
  const mdSource = [
    '# Title',
    '',
    'Intro text.',
    '',
    '## Section A',
    '',
    'Body of A.',
    '',
    '```sh',
    '# not a heading',
    'echo hi',
    '```',
    '',
    '### Deep',
    '',
    'Deep body.',
    '',
    '## Section B',
    '',
    'Body of B.',
  ].join('\n');
  const mdBin = binary(mdSource, 'notes.md');
  assert(await md.detect(mdBin), 'markdown detected');
  const mdRead = await md.read(doc('notes.md'), mdBin, { kind: 'all' });
  const mdHeadings = mdRead.chunks
    .flatMap((chunk) => (chunk.location.heading ? [chunk.location.heading] : []));
  assert(
    !mdHeadings.includes('not a heading'),
    'a # inside a fenced block is not a heading',
  );
  assert(
    mdHeadings.join('|') === 'Title|Section A|Deep|Section B',
    `headings in order (got ${mdHeadings.join('|')})`,
  );
  const deep = mdRead.chunks.find((chunk) => chunk.location.heading === 'Deep');
  assert(
    deep?.location.headingPath?.join(' > ') === 'Title > Section A > Deep',
    'heading path carries ancestors',
  );
  const sectionB = mdRead.chunks.find((chunk) => chunk.location.heading === 'Section B');
  assert(
    sectionB?.location.headingPath?.join(' > ') === 'Title > Section B',
    'a shallower heading trims stale ancestors',
  );

  const sectionRead = await md.read(doc('notes.md'), mdBin, {
    kind: 'heading',
    heading: 'Section A',
  });
  const sectionText = sectionRead.chunks.map((c) => c.text ?? '').join('\n');
  assert(sectionText.includes('Body of A.'), 'heading selector returns that section');
  assert(sectionText.includes('Deep body.'), 'heading selector includes nested subsections');
  assert(!sectionText.includes('Body of B.'), 'heading selector stops at the next sibling');

  console.log('\njson:');
  const json = new JsonAdapter();
  const arrRead = await json.read(doc('a.json'), binary('[{"a":1},{"a":2},{"a":3}]', 'a.json'), { kind: 'all' });
  assert(arrRead.chunks.length === 3, 'array splits per element');
  const objRead = await json.read(doc('o.json'), binary('{"x":1,"y":{"z":2}}', 'o.json'), { kind: 'all' });
  assert(objRead.chunks.length === 2, 'object splits per top-level key');
  assert(objRead.chunks[0]!.location.range === '$.x', 'key location is a path');
  const jsonl = await json.read(doc('l.jsonl'), binary('{"a":1}\n{"a":2}\n', 'l.jsonl'), { kind: 'all' });
  assert(jsonl.chunks.length === 2, 'jsonl splits per line');
  const broken = await json.read(doc('b.json'), binary('{"a":1', 'b.json'), { kind: 'all' });
  assert(broken.chunks.length === 1 && (broken.chunks[0]!.text ?? '').includes('"a"'),
    'unparseable json is still readable as text');

  console.log('\nhtml:');
  const html = new HtmlAdapter();
  const page = [
    '<!doctype html><html><head><title>T</title>',
    '<style>body{color:red}</style></head><body>',
    '<script>var leak = "SHOULD_NOT_APPEAR";</script>',
    '<h1>Heading One</h1><p>First &amp; only.</p>',
    '<h2>Sub</h2><p>Nested&nbsp;body.</p>',
    '</body></html>',
  ].join('');
  const htmlBin = binary(page, 'page.html');
  assert(await html.detect(htmlBin), 'html detected');
  const htmlRead = await html.read(doc('page.html'), htmlBin, { kind: 'all' });
  const allText = htmlRead.chunks.map((c) => c.text ?? '').join(' ');
  assert(!allText.includes('SHOULD_NOT_APPEAR'), 'script contents are dropped');
  assert(!allText.includes('color:red'), 'style contents are dropped');
  assert(allText.includes('First & only.'), 'entities decode');
  assert(allText.includes('Nested body.'), 'nbsp becomes a space');
  const htmlHeadings = htmlRead.chunks.flatMap((c) => (c.location.heading ? [c.location.heading] : []));
  assert(htmlHeadings.join('|') === 'Heading One|Sub', `html headings (got ${htmlHeadings.join('|')})`);

  console.log('\ntext and cursoring:');
  const text = new TextAdapter({ maxCharsPerChunk: 40, maxChunksPerRead: 2 });
  const paragraphs = Array.from({ length: 9 }, (_, i) => `Paragraph number ${i} with some words.`);
  const textBin = binary(paragraphs.join('\n\n'), 'notes.txt');
  const textDoc = doc('notes.txt');

  const seen: string[] = [];
  let cursor: string | undefined;
  let reads = 0;
  do {
    const result: Awaited<ReturnType<typeof text.read>> = await text.read(
      textDoc,
      textBin,
      cursor ? { kind: 'cursor', cursor } : { kind: 'all' },
    );
    for (const chunk of result.chunks) seen.push(chunk.text ?? '');
    cursor = result.cursor;
    reads += 1;
    if (reads > 20) break;
  } while (cursor);

  assert(reads > 1, `cursoring actually paginated (${reads} reads)`);
  const rejoined = seen.join('\n');
  const everyParagraphOnce = paragraphs.every(
    (p) => rejoined.split(p).length === 2,
  );
  assert(everyParagraphOnce, 'every paragraph appears exactly once across the reads');

  console.log('\nsearch:');
  const hits = await md.search(doc('notes.md'), mdBin, 'body of b');
  assert(hits.hits.length === 1, 'search is case-insensitive and finds the section');
  assert(
    hits.hits[0]!.location.headingPath?.includes('Section B') === true,
    'a hit carries the location that produced it',
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nformat adapters verified.');
}

main().catch((error) => {
  console.error('\n', error);
  process.exit(1);
});
