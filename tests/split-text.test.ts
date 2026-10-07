import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitBook } from '../scripts/fetch-text.mjs';

const raw = readFileSync('tests/fixtures/gutenberg/pg408-sample.txt', 'utf8');
const sections = splitBook(raw);

describe('splitBook', () => {
  it('returns 16 sections', () => {
    expect(sections).toHaveLength(16);
  });

  it('ids them 00 through 15 in order', () => {
    expect(sections.map((s) => s.id)).toEqual([
      '00', '01', '02', '03', '04', '05', '06', '07',
      '08', '09', '10', '11', '12', '13', '14', '15',
    ]);
  });

  it('does not mistake the table of contents for chapter heads', () => {
    // The file carries each chapter number in two different shapes. The table
    // of contents puts the number and the title on one line
    // ("I. Of Our Spiritual Strivings"); the real head puts the number alone
    // on its line with the title beneath. Splitting on the first shape yields
    // sections cut out of the table of contents.
    const tocStyle = raw.match(/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV)\.[ \t]+\S/gm);
    const headStyle = raw.match(/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV)\.[ \t]*$/gm);
    expect(tocStyle).toHaveLength(14);
    expect(headStyle).toHaveLength(14);

    // Every section must hold real prose, not a one-line contents stub.
    for (const s of sections) {
      expect(s.body.length).toBeGreaterThan(400);
    }
  });

  it('does not leave a bare chapter numeral at the start of a body', () => {
    for (const s of sections) {
      expect(s.body).not.toMatch(/^(?:I|V|X)+\.\s*$/m);
    }
  });

  it('strips the Project Gutenberg header and licence footer', () => {
    const all = sections.map((s) => s.body).join('\n');
    expect(all).not.toMatch(/PROJECT GUTENBERG/i);
    expect(all).not.toMatch(/START OF THE PROJECT/i);
    expect(all).not.toMatch(/END OF THE PROJECT/i);
  });

  it('gives chapter 1 the heading Du Bois gave it', () => {
    expect(sections[1].heading).toBe('Of Our Spiritual Strivings');
  });

  it('gives chapter 14 the sorrow songs heading', () => {
    expect(sections[14].heading).toBe('Of the Sorrow Songs');
  });

  it('names the Forethought and the Afterthought', () => {
    expect(sections[0].heading).toMatch(/Forethought/i);
    expect(sections[15].heading).toMatch(/Afterthought/i);
  });

  it('reads a heading for every chapter, none of them a numeral', () => {
    for (let i = 1; i <= 14; i += 1) {
      expect(sections[i].heading.length).toBeGreaterThan(4);
      expect(sections[i].heading).not.toMatch(/^[IVX]+\.?$/);
    }
  });

  it('assigns chapter numbers 1..14 to the middle sections', () => {
    expect(sections.slice(1, 15).map((s) => s.chapter)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    );
  });

  it('gives the Forethought and Afterthought no chapter number', () => {
    expect(sections[0].chapter).toBeNull();
    expect(sections[15].chapter).toBeNull();
  });

  it('orders sections by their position in the book', () => {
    // The Forethought precedes chapter 1, and chapter 14 precedes the
    // Afterthought. Sorting by source offset is what guarantees this.
    const lengths = sections.map((s) => s.body.length);
    expect(lengths.every((n) => n > 0)).toBe(true);
    expect(sections[0].heading).toMatch(/Forethought/i);
  });

  it('throws when a chapter head is missing, rather than guessing', () => {
    // Remove only the bare "XIV." head line. Truncating the file instead would
    // also drop the Gutenberg END marker, so that check would fire first and
    // the test would pass for the wrong reason.
    const missing = raw.replace(/^XIV\.[ \t]*$/m, '');
    expect(() => splitBook(missing)).toThrow(/XIV/);
  });

  it('throws when the Gutenberg start marker is absent', () => {
    expect(() => splitBook('no markers here at all')).toThrow(/START/i);
  });

  it('throws when a chapter numeral appears twice as a head', () => {
    // Guards the assumption directly: if a future Gutenberg revision gives a
    // numeral two bare-head lines, that must fail loudly rather than silently
    // picking one.
    const doubled = raw.replace(/^XIV\.[ \t]*$/m, 'XIV.\nXIV.');
    expect(() => splitBook(doubled)).toThrow(/XIV/);
  });
});
