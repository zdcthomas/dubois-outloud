import { describe, expect, it } from 'vitest';
import { applyDecision, rightsWarning } from '../scripts/vet.mjs';

const entry = (loc_id: string, status = 'unreviewed') => ({
  song: 'steal-away', loc_id, status, delivery: null, note: null, loc: null,
});

// applyDecision lives in a .mjs module, so its return is untyped and the
// strict tsconfig flags every callback below without this.
type Entry = ReturnType<typeof entry>;

describe('applyDecision', () => {
  it('approves the named entry', () => {
    const out = applyDecision([entry('a'), entry('b')], 'b', 'approved', 'A note.');
    expect(out.find((e: Entry) => e.loc_id === 'b')!.status).toBe('approved');
    expect(out.find((e: Entry) => e.loc_id === 'b')!.note).toBe('A note.');
  });

  it('leaves every other entry untouched', () => {
    const before = [entry('a'), entry('b')];
    const out = applyDecision(before, 'b', 'rejected', null);
    expect(out.find((e: Entry) => e.loc_id === 'a')).toEqual(before[0]);
  });

  it('keeps an existing note when none is supplied', () => {
    const kept = { ...entry('a', 'unreviewed'), note: 'Earlier note.' };
    expect(applyDecision([kept], 'a', 'approved', null)[0].note)
      .toBe('Earlier note.');
  });

  it('throws on an unknown loc_id rather than silently doing nothing', () => {
    expect(() => applyDecision([entry('a')], 'nope', 'approved', null))
      .toThrow(/nope/);
  });

  it('refuses a status that is not one of the three', () => {
    expect(() => applyDecision([entry('a')], 'a', 'maybe' as never, null))
      .toThrow(/maybe/);
  });

  it('returns a new array rather than mutating the input', () => {
    const before = [entry('a')];
    applyDecision(before, 'a', 'approved', 'x');
    expect(before[0].status).toBe('unreviewed');
  });
});

describe('rightsWarning', () => {
  const jukebox = (date: string) => ({
    date, collection: 'national jukebox', collections: ['national jukebox'],
  });

  it('warns on a post-1923 National Jukebox side', () => {
    expect(rightsWarning(jukebox('1931-03-04'))).toMatch(/NOT public domain/);
  });

  it('is silent on a pre-1923 Jukebox side, which is public domain', () => {
    expect(rightsWarning(jukebox('1917-11-21'))).toBeNull();
  });

  it('treats 1923 itself as outside the public domain', () => {
    expect(rightsWarning(jukebox('1923-01-01'))).toMatch(/NOT public domain/);
    expect(rightsWarning(jukebox('1922-12-31'))).toBeNull();
  });

  it('finds the collection even when it is not first', () => {
    expect(rightsWarning({
      date: '1930', collection: 'recorded sound section',
      collections: ['recorded sound section', 'national jukebox'],
    })).toMatch(/NOT public domain/);
  });

  it('is silent on a Folklife field recording of any date', () => {
    expect(rightsWarning({
      date: '1939-06-11', collection: 'american folklife center',
      collections: ['american folklife center'],
    })).toBeNull();
  });

  it('is silent when there is no metadata to judge', () => {
    expect(rightsWarning(null)).toBeNull();
  });
});
