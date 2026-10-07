import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { idFromResult, newCandidates } from '../scripts/find-recordings.mjs';

const search = JSON.parse(
  readFileSync('tests/fixtures/loc/search-steal-away.json', 'utf8'),
);

describe('idFromResult', () => {
  it('extracts the item id from an http url', () => {
    expect(idFromResult({ id: 'http://www.loc.gov/item/jukebox-4649/' }))
      .toBe('jukebox-4649');
  });

  it('extracts the item id from an https url', () => {
    expect(idFromResult({ id: 'https://www.loc.gov/item/lomaxbib000533/' }))
      .toBe('lomaxbib000533');
  });

  it('returns null for a result that is not an item', () => {
    expect(idFromResult({ id: 'http://www.loc.gov/collections/national-jukebox/' }))
      .toBeNull();
  });

  it('returns null for a missing id', () => {
    expect(idFromResult({})).toBeNull();
  });
});

describe('newCandidates', () => {
  it('turns search results into unreviewed entries', () => {
    const out = newCandidates(search.results, 'steal-away', new Set());
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) {
      expect(e.status).toBe('unreviewed');
      expect(e.song).toBe('steal-away');
      expect(e.delivery).toBeNull();
      expect(e.note).toBeNull();
      expect(e.loc).toBeNull();
    }
  });

  it('skips an id already in the manifest', () => {
    const all = newCandidates(search.results, 'steal-away', new Set());
    const skipOne = new Set([all[0].loc_id]);
    const out = newCandidates(search.results, 'steal-away', skipOne);
    expect(out.map((e) => e.loc_id)).not.toContain(all[0].loc_id);
    expect(out).toHaveLength(all.length - 1);
  });

  it('returns nothing when every id is already known', () => {
    const all = newCandidates(search.results, 'steal-away', new Set());
    const known = new Set(all.map((e) => e.loc_id));
    expect(newCandidates(search.results, 'steal-away', known)).toEqual([]);
  });

  it('never emits the same id twice from one result set', () => {
    const doubled = [...search.results, ...search.results];
    const out = newCandidates(doubled, 'steal-away', new Set());
    const ids = out.map((e) => e.loc_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps only results that loc.gov marks as audio', () => {
    const notAudio = [{ id: 'http://www.loc.gov/item/x-1/', online_format: ['image'] }];
    expect(newCandidates(notAudio, 'steal-away', new Set())).toEqual([]);
  });

  it('does not resurrect a recording that was already rejected', () => {
    // The whole point of passing every known id, not just the approved ones:
    // a re-run must not offer back something a human already turned down.
    const all = newCandidates(search.results, 'steal-away', new Set());
    const rejected = new Set([all[0].loc_id]);
    expect(newCandidates(search.results, 'steal-away', rejected)
      .map((e) => e.loc_id)).not.toContain(all[0].loc_id);
  });

  it('produces entries the schema accepts', async () => {
    const { recordingSchema } = await import('../src/schemas.ts');
    for (const e of newCandidates(search.results, 'steal-away', new Set())) {
      expect(() => recordingSchema.parse(e)).not.toThrow();
    }
  });
});
