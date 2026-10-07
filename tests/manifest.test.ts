import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readManifest, refreshEntry, writeManifest } from '../scripts/lib/manifest.mjs';

const parsed = {
  title: 'Steal away', date: '1902-10-29', collection: 'national jukebox',
  collections: ['national jukebox'],
  performers: ['Fisk University Jubilee Quartet'], place: null,
  duration_seconds: 150, audio_url: 'https://tile.loc.gov/new.mp3',
  can_download: true, rights: 'No known restrictions.',
  item_url: 'https://www.loc.gov/item/jukebox-4649/',
};

const tmpManifest = () => join(mkdtempSync(join(tmpdir(), 'dubois-')), 'recordings.yaml');

describe('refreshEntry', () => {
  const human = {
    song: 'steal-away', loc_id: 'jukebox-4649',
    status: 'approved', delivery: 'stream',
    note: 'Teacher note that must survive.',
    loc: { ...parsed, audio_url: 'https://tile.loc.gov/old.mp3', checked: '2020-01-01' },
  };

  it('replaces the loc block', () => {
    const out = refreshEntry(human, parsed, '2026-10-07');
    expect(out.loc.audio_url).toBe('https://tile.loc.gov/new.mp3');
    expect(out.loc.checked).toBe('2026-10-07');
  });

  it('never changes status', () => {
    expect(refreshEntry(human, parsed, '2026-10-07').status).toBe('approved');
  });

  it('never changes a note', () => {
    expect(refreshEntry(human, parsed, '2026-10-07').note)
      .toBe('Teacher note that must survive.');
  });

  it('never overwrites a delivery a human already set', () => {
    // The rule would propose selfhost here; the human said stream.
    expect(refreshEntry(human, parsed, '2026-10-07').delivery).toBe('stream');
  });

  it('proposes a delivery only when the field is null', () => {
    const fresh = { ...human, delivery: null };
    expect(refreshEntry(fresh, parsed, '2026-10-07').delivery).toBe('selfhost');
  });

  it('carries the collections array through to the stored block', () => {
    const out = refreshEntry({ ...human, delivery: null }, parsed, '2026-10-07');
    expect(out.loc.collections).toEqual(['national jukebox']);
  });

  it('leaves the existing loc block alone when the item has no audio', () => {
    const out = refreshEntry(human, null, '2026-10-07');
    expect(out.loc.audio_url).toBe('https://tile.loc.gov/old.mp3');
  });

  it('does not invent a loc block for an item with no audio', () => {
    const bare = { ...human, loc: null };
    expect(refreshEntry(bare, null, '2026-10-07').loc).toBeNull();
  });

  it('preserves a rejected entry untouched when the item has no audio', () => {
    const rejected = { song: 'poor-rosy', loc_id: 'x', status: 'rejected',
                       delivery: null, note: 'No voices.', loc: null };
    expect(refreshEntry(rejected, null, '2026-10-07')).toEqual(rejected);
  });

  it('keeps an empty-string note rather than turning it into null', () => {
    // ?? only falls through on null/undefined, so '' must survive. A teacher
    // clearing a note should not see it silently become something else.
    const out = refreshEntry({ ...human, note: '' }, parsed, '2026-10-07');
    expect(out.note).toBe('');
  });
});

describe('readManifest and writeManifest', () => {
  it('round-trips an entry without losing or reordering keys', () => {
    const path = tmpManifest();
    const entries = [{
      song: 'steal-away', loc_id: 'jukebox-4649', status: 'approved',
      delivery: 'selfhost', note: 'A note.', loc: { ...parsed, checked: '2026-10-07' },
    }];
    writeManifest(path, entries);
    expect(readManifest(path)).toEqual(entries);
  });

  it('preserves an apostrophe in a note', () => {
    const path = tmpManifest();
    const entries = [{
      song: 'steal-away', loc_id: 'x', status: 'rejected',
      delivery: null, note: "Piano only; there's no voice on this one.", loc: null,
    }];
    writeManifest(path, entries);
    expect(readManifest(path)[0].note)
      .toBe("Piano only; there's no voice on this one.");
  });

  it('preserves a multi-line note', () => {
    const path = tmpManifest();
    const note = 'Fisk University Jubilee Quartet, 1917.\nCompare with chapter 2.';
    writeManifest(path, [{ song: 's', loc_id: 'x', status: 'approved',
                           delivery: 'stream', note, loc: null }]);
    expect(readManifest(path)[0].note).toBe(note);
  });

  it('writes the header comment that tells a human which fields are theirs', () => {
    const path = tmpManifest();
    writeManifest(path, []);
    expect(readFileSync(path, 'utf8')).toMatch(/You own `status`, `delivery` and `note`/);
  });

  it('returns an empty array for a manifest holding only comments', () => {
    const path = tmpManifest();
    writeFileSync(path, '# nothing here yet\n');
    expect(readManifest(path)).toEqual([]);
  });

  it('returns an empty array for a completely empty file', () => {
    const path = tmpManifest();
    writeFileSync(path, '');
    expect(readManifest(path)).toEqual([]);
  });

  it('survives a write/read/write cycle without drift', () => {
    // fetch-loc.mjs rewrites the whole file on every run, so a stable
    // round-trip is what stops the manifest churning in git diffs.
    const path = tmpManifest();
    const entries = [{
      song: 'steal-away', loc_id: 'jukebox-4649', status: 'approved',
      delivery: 'selfhost', note: 'A note.', loc: { ...parsed, checked: '2026-10-07' },
    }];
    writeManifest(path, entries);
    const once = readFileSync(path, 'utf8');
    writeManifest(path, readManifest(path));
    expect(readFileSync(path, 'utf8')).toBe(once);
  });
});
