import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchText } from './lib/http.mjs';

const SOURCE = 'https://www.gutenberg.org/cache/epub/408/pg408.txt';
const OUT_DIR = 'src/content/chapters';

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII',
                  'IX', 'X', 'XI', 'XII', 'XIII', 'XIV'];

/**
 * Split the Gutenberg plain text into 16 sections: the Forethought, chapters
 * 1 to 14, and the Afterthought.
 *
 * The hazard is that the file carries each chapter number in two different
 * shapes, and only one of them is a chapter head:
 *
 *   table of contents:  "I. Of Our Spiritual Strivings"   <- number and title
 *   the real head:      "I."                              <- number alone
 *                       "Of Our Spiritual Strivings"      <- title beneath
 *
 * Matching the first shape finds fourteen lines that all sit inside the table
 * of contents, so every "chapter" comes out as a one-line stub. We therefore
 * anchor on the bare-numeral line and read the title from beneath it.
 *
 * The same trap applies to the front matter: the contents list an indented
 * "The Forethought", while the real heading sits at column 0.
 *
 * Every count is asserted. If a future Gutenberg revision reformats the file,
 * this throws instead of quietly emitting stubs.
 */
export function splitBook(raw) {
  const text = raw.replace(/\r\n/g, '\n');

  const startAt = text.search(/^\*\*\* START OF THE PROJECT GUTENBERG EBOOK.*$/m);
  if (startAt < 0) throw new Error('Gutenberg START marker not found');
  const endAt = text.search(/^\*\*\* END OF THE PROJECT GUTENBERG EBOOK.*$/m);
  if (endAt < 0) throw new Error('Gutenberg END marker not found');

  const body = text.slice(text.indexOf('\n', startAt) + 1, endAt);

  const marks = [];

  // The two unnumbered sections. Anchored at column 0 so the indented table
  // of contents entries do not match.
  for (const [id, label] of [['00', 'The Forethought'], ['15', 'The Afterthought']]) {
    const hits = [...body.matchAll(new RegExp(`^${label}[ \\t]*$`, 'gm'))];
    if (hits.length !== 1) {
      throw new Error(
        `Expected "${label}" to appear exactly once as a heading at column 0, ` +
          `but found ${hits.length}. The file at ${SOURCE} may have been reformatted.`,
      );
    }
    marks.push({ id, chapter: null, heading: label, at: hits[0].index, headingLines: 1 });
  }

  // The fourteen chapters.
  NUMERALS.forEach((numeral, i) => {
    const hits = [...body.matchAll(new RegExp(`^${numeral}\\.[ \\t]*$`, 'gm'))];
    if (hits.length !== 1) {
      throw new Error(
        `Expected the chapter head "${numeral}." to appear exactly once on a ` +
          `line of its own, but found ${hits.length}. The file at ${SOURCE} ` +
          `may have been reformatted.`,
      );
    }
    const at = hits[0].index;

    // The title is the first non-empty line after the numeral.
    const after = body.slice(at + hits[0][0].length).split('\n');
    const heading = after.find((line) => line.trim().length > 0)?.trim();
    if (!heading) {
      throw new Error(`Found the head "${numeral}." but no title line beneath it.`);
    }

    marks.push({
      id: String(i + 1).padStart(2, '0'),
      chapter: i + 1,
      heading,
      at,
      // The numeral line and the title line both belong to the heading.
      headingLines: 2,
    });
  });

  marks.sort((a, b) => a.at - b.at);

  return marks.map((mark, i) => {
    const stop = i + 1 < marks.length ? marks[i + 1].at : body.length;
    const lines = body.slice(mark.at, stop).split('\n');
    return {
      id: mark.id,
      chapter: mark.chapter,
      heading: mark.heading,
      body: dropHeadingLines(lines, mark.headingLines).join('\n').trim(),
    };
  });
}

/**
 * Drop the heading from the top of a section, counting only non-empty lines,
 * so blank lines between the numeral and the title do not shift the count.
 */
function dropHeadingLines(lines, count) {
  let dropped = 0;
  let i = 0;
  while (i < lines.length && dropped < count) {
    if (lines[i].trim().length > 0) dropped += 1;
    i += 1;
  }
  return lines.slice(i);
}

function toMarkdown({ chapter, heading, body }) {
  return [
    '---',
    `heading: ${JSON.stringify(heading)}`,
    `chapter: ${chapter === null ? 'null' : String(chapter)}`,
    'source: "Project Gutenberg eBook 408, the 1903 edition, public domain"',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

async function main() {
  const raw = await fetchText(SOURCE);
  const sections = splitBook(raw);
  mkdirSync(OUT_DIR, { recursive: true });
  for (const section of sections) {
    writeFileSync(`${OUT_DIR}/${section.id}.md`, toMarkdown(section));
  }
  console.log(`Wrote ${sections.length} sections to ${OUT_DIR}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
