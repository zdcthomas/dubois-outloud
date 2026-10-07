import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { recordingSchema, validateManifest } from '../src/schemas.ts';

const SLUGS = ['steal-away', 'poor-rosy'];

const approved = {
  song: 'steal-away',
  loc_id: 'jukebox-4649',
  status: 'approved',
  delivery: 'selfhost',
  note: null,
  loc: {
    title: 'Steal away',
    date: '1902-10-29',
    collection: 'national jukebox',
    performers: ['Fisk University Jubilee Quartet'],
    place: null,
    duration_seconds: 150,
    audio_url: 'https://tile.loc.gov/x.mp3',
    can_download: true,
    rights: 'No known restrictions.',
    item_url: 'https://www.loc.gov/item/jukebox-4649/',
    checked: '2026-10-07',
  },
};

describe('recordingSchema', () => {
  it('accepts a fully vetted entry', () => {
    expect(() => recordingSchema.parse(approved)).not.toThrow();
  });

  it('accepts an unreviewed entry with no loc block', () => {
    const fresh = { song: 'poor-rosy', loc_id: 'x-1', status: 'unreviewed',
                    delivery: null, note: null, loc: null };
    expect(() => recordingSchema.parse(fresh)).not.toThrow();
  });

  // These assert ZodError rather than a bare .toThrow(). A bare .toThrow()
  // passes when recordingSchema is undefined, because undefined.parse() throws
  // a TypeError — so the loose version went green while the schema did not
  // exist, and would never have caught the export going away.
  it.each(['pending', 'APPROVED', '', 'ok'])('rejects status %s', (status) => {
    expect(() => recordingSchema.parse({ ...approved, status })).toThrow(ZodError);
  });

  it.each(['host', 'download', 'embed'])('rejects delivery %s', (delivery) => {
    expect(() => recordingSchema.parse({ ...approved, delivery })).toThrow(ZodError);
  });

  it('rejects an audio_url that is not a url', () => {
    const bad = { ...approved, loc: { ...approved.loc, audio_url: 'not-a-url' } };
    expect(() => recordingSchema.parse(bad)).toThrow(ZodError);
  });
});

describe('validateManifest', () => {
  it('passes a clean manifest', () => {
    expect(() => validateManifest([approved], SLUGS)).not.toThrow();
  });

  it('rejects a song slug that is not in songs.yaml', () => {
    const orphan = { ...approved, song: 'no-such-song' };
    expect(() => validateManifest([orphan], SLUGS)).toThrow(/no-such-song/);
  });

  it('names the loc_id when it rejects an entry', () => {
    const orphan = { ...approved, song: 'no-such-song' };
    expect(() => validateManifest([orphan], SLUGS)).toThrow(/jukebox-4649/);
  });

  it('rejects an approved entry with no audio_url', () => {
    const dead = { ...approved, loc: { ...approved.loc, audio_url: null } };
    expect(() => validateManifest([dead], SLUGS)).toThrow(/audio_url/);
  });

  it('rejects an approved entry with no loc block at all', () => {
    const bare = { ...approved, loc: null };
    expect(() => validateManifest([bare], SLUGS)).toThrow(/jukebox-4649/);
  });

  it('rejects an approved entry with no delivery set', () => {
    const undecided = { ...approved, delivery: null };
    expect(() => validateManifest([undecided], SLUGS)).toThrow(/delivery/);
  });

  it('rejects selfhost when can_download is false', () => {
    const nope = { ...approved, loc: { ...approved.loc, can_download: false } };
    expect(() => validateManifest([nope], SLUGS)).toThrow(/can_download/);
  });

  it('allows a rejected entry to be incomplete', () => {
    const rej = { song: 'poor-rosy', loc_id: 'x-2', status: 'rejected',
                  delivery: null, note: 'Piano only, no voices.', loc: null };
    expect(() => validateManifest([rej], SLUGS)).not.toThrow();
  });

  it('allows an unreviewed entry to be incomplete', () => {
    const fresh = { song: 'poor-rosy', loc_id: 'x-3', status: 'unreviewed',
                    delivery: null, note: null, loc: null };
    expect(() => validateManifest([fresh], SLUGS)).not.toThrow();
  });

  it('allows an approved stream entry with can_download false', () => {
    const streamed = {
      ...approved,
      delivery: 'stream',
      loc: { ...approved.loc, can_download: false },
    };
    expect(() => validateManifest([streamed], SLUGS)).not.toThrow();
  });

  it('checks an orphan slug even on an unreviewed entry', () => {
    // A typo in `song` is a typo whatever the status; catching it only on
    // approval means it hides until the day someone approves the entry.
    const orphan = { song: 'no-such-song', loc_id: 'x-4', status: 'unreviewed',
                     delivery: null, note: null, loc: null };
    expect(() => validateManifest([orphan], SLUGS)).toThrow(/no-such-song/);
  });
});

describe('validateManifest duplicate detection', () => {
  it('rejects two entries sharing a loc_id', () => {
    const a = { ...approved };
    const b = { ...approved, song: 'poor-rosy' };
    expect(() => validateManifest([a, b], SLUGS)).toThrow(/duplicate loc_id/);
  });

  it('names both songs when it reports a duplicate', () => {
    const a = { ...approved };
    const b = { ...approved, song: 'poor-rosy' };
    expect(() => validateManifest([a, b], SLUGS)).toThrow(/steal-away/);
  });

  it('allows the same song to have several different recordings', () => {
    const a = { ...approved };
    const b = { ...approved, loc_id: 'jukebox-9999' };
    expect(() => validateManifest([a, b], SLUGS)).not.toThrow();
  });

  it('catches a duplicate even when one of the pair is rejected', () => {
    // find-recordings.mjs re-running must not resurrect a turned-down id as a
    // second entry for the same recording.
    const a = { ...approved };
    const b = { ...approved, status: 'rejected', delivery: null, loc: null };
    expect(() => validateManifest([a, b], SLUGS)).toThrow(/duplicate loc_id/);
  });
});

describe('validateManifest on an empty manifest', () => {
  it('passes, so a fresh checkout builds', () => {
    expect(() => validateManifest([], SLUGS)).not.toThrow();
  });
});
