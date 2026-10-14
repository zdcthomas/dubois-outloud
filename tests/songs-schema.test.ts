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

  it('names a scan for every song, so no chapter head comes up blank', () => {
    expect(songs.filter((s) => s.scan === null)).toEqual([]);
  });

  it('gives any Internet Archive scan a sane crop box', () => {
    // A zero or inverted box crops to nothing, and sharp throws at build time.
    // Plate scans carry no box — they are already cropped — so they skip this.
    const cropped = songs.filter((s) => s.scan !== null && 'crop' in s.scan);
    expect(cropped.length).toBeGreaterThan(0);
    for (const song of cropped) {
      const scan = song.scan as { page: number; crop: number[] };
      const [left, top, right, bottom] = scan.crop;
      expect(right).toBeGreaterThan(left);
      expect(bottom).toBeGreaterThan(top);
      expect(scan.page).toBeGreaterThan(0);
    }
  });

  it('accepts a plate scan', () => {
    const good = { ...songs[0], scan: { plate: 'https://way.net/x/01.gif' } };
    expect(() => songsSchema.parse(good)).not.toThrow();
  });

  it('rejects a plate that is not a URL', () => {
    // A bare filename would send fetchBinary nowhere useful, and the chapter
    // head would fail at fetch time rather than here.
    expect(() => songsSchema.parse({ ...songs[0], scan: { plate: '01.gif' } })).toThrow();
  });

  it('rejects a scan that is neither shape', () => {
    expect(() => songsSchema.parse({ ...songs[0], scan: { page: 16 } })).toThrow();
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
