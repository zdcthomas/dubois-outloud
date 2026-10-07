import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { slugify } from '../scripts/lib/slug.mjs';
import { songsSchema, type Song } from '../src/schemas.ts';

// yaml's parse() returns any; annotate so the strict tsconfig can check the
// callbacks below rather than flagging each one as an implicit any.
const songs: Song[] = parse(readFileSync('src/data/songs.yaml', 'utf8'));

describe('songs.yaml', () => {
  it('holds 18 songs', () => {
    expect(songs).toHaveLength(18);
  });

  it('validates against the schema', () => {
    for (const song of songs) {
      expect(() => songsSchema.parse(song)).not.toThrow();
    }
  });

  it('gives every song a slug that slugify would produce from its title', () => {
    for (const song of songs) {
      expect(song.slug).toBe(slugify(song.title));
    }
  });

  it('uses every slug exactly once', () => {
    const slugs = songs.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('covers chapters 1 through 14 with no gaps', () => {
    const chapters = new Set(songs.map((s) => s.chapter));
    expect([...chapters].sort((a, b) => a - b)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    );
  });

  it('gives chapter 14 five songs and every other chapter one', () => {
    const counts = new Map<number, number>();
    for (const s of songs) counts.set(s.chapter, (counts.get(s.chapter) ?? 0) + 1);
    expect(counts.get(14)).toBe(5);
    for (const ch of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      expect(counts.get(ch)).toBe(1);
    }
  });

  it('gives any song that has scan coordinates a sane crop box', () => {
    // Most songs are still null — finding each page index is curation work.
    // The ones that are filled in must describe a real rectangle, because a
    // zero or inverted box crops to nothing and sharp throws at build time.
    for (const song of songs.filter((s) => s.scan !== null)) {
      const [left, top, right, bottom] = song.scan!.crop;
      expect(right).toBeGreaterThan(left);
      expect(bottom).toBeGreaterThan(top);
      expect(song.scan!.page).toBeGreaterThan(0);
    }
  });

  it('rejects a chapter outside 1..14', () => {
    expect(() => songsSchema.parse({ ...songs[0], chapter: 15 })).toThrow();
    expect(() => songsSchema.parse({ ...songs[0], chapter: 0 })).toThrow();
  });

  it('rejects a crop box that is not four numbers', () => {
    const bad = { ...songs[0], scan: { ia_item: 'x', page: 1, crop: [1, 2, 3] } };
    expect(() => songsSchema.parse(bad)).toThrow();
  });

  it('accepts a fully specified scan block', () => {
    const good = {
      ...songs[0],
      scan: { ia_item: 'cu31924024920492', page: 41, crop: [0, 0, 100, 50] },
    };
    expect(() => songsSchema.parse(good)).not.toThrow();
  });

  it('rejects a slug carrying punctuation', () => {
    expect(() => songsSchema.parse({ ...songs[0], slug: "nobody-knows-i've" })).toThrow();
    expect(() => songsSchema.parse({ ...songs[0], slug: 'Nobody-Knows' })).toThrow();
  });
});
