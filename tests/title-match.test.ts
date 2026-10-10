import { describe, expect, it } from 'vitest';
import { titleMatches } from '../scripts/find-recordings.mjs';

describe('titleMatches', () => {
  it('keeps the exact title', () => {
    expect(titleMatches('Steal Away', 'Steal away')).toBe(true);
  });

  it('keeps a longer variant of the same song', () => {
    expect(titleMatches('Steal Away', 'Steal away to Jesus')).toBe(true);
  });

  it('keeps dialect spellings, which these titles are full of', () => {
    expect(titleMatches("Nobody Knows the Trouble I've Seen",
      "Nobody knows de trouble I've seen")).toBe(true);
    expect(titleMatches('Swing Low, Sweet Chariot', 'Swing low, sweet chariot')).toBe(true);
  });

  it('rejects the oral histories that wrecked the first pass', () => {
    const song = 'A Great Camp-meeting in the Promised Land';
    expect(titleMatches(song, 'Grant Hayao Ichikawa Collection')).toBe(false);
    expect(titleMatches(song,
      'James L. Prevatt interview conducted by Christopher Sims, 2017-09-30')).toBe(false);
    expect(titleMatches(song,
      'Speech at the National Press Club luncheon, Washington, Mar. 23, 1978')).toBe(false);
  });

  it('rejects the marches that swamped "March On"', () => {
    // One short, extremely common content word. Anything less strict than a
    // phrase match turns every Sousa record into a candidate.
    expect(titleMatches('March On', 'Manhattan Beach march')).toBe(false);
    expect(titleMatches('March On', 'Pirotski march (Naroden march)')).toBe(false);
    expect(titleMatches('March On', 'U.S. Marine March')).toBe(false);
    expect(titleMatches('March On', 'The assembly march')).toBe(false);
  });

  it('still keeps a real "March On" if one turns up', () => {
    expect(titleMatches('March On', 'March on')).toBe(true);
    expect(titleMatches('March On', 'March on, ye soldiers')).toBe(true);
  });

  it('keeps a dialect spelling that no prefix match would catch', () => {
    // The Lomax recording already approved for chapter 2. The manifest says
    // "Mourning"; the record says "Mornin'". Partial-overlap scoring is the
    // only reason this survives.
    expect(titleMatches('My Lord, What a Mourning', "My Lord, What a Mornin'")).toBe(true);
  });

  it('rejects an unrelated record that merely shares a word', () => {
    expect(titleMatches('Steal Away', 'Space unicorn blues')).toBe(false);
    expect(titleMatches('Steal Away', 'Gems from A modern Eve')).toBe(false);
  });

  it('ignores case, punctuation and apostrophes', () => {
    expect(titleMatches("My Way's Cloudy", 'MY WAYS CLOUDY')).toBe(true);
  });

  it('survives a missing or empty title rather than throwing', () => {
    expect(titleMatches('Steal Away', '')).toBe(false);
    expect(titleMatches('Steal Away', null as never)).toBe(false);
  });
});
