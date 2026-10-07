import { describe, expect, it } from 'vitest';
import { slugify } from '../scripts/lib/slug.mjs';

describe('slugify', () => {
  it.each([
    ["Nobody Knows the Trouble I've Seen", 'nobody-knows-the-trouble-ive-seen'],
    ["Children, You'll Be Called On", 'children-youll-be-called-on'],
    ['My Lord, What a Mourning', 'my-lord-what-a-mourning'],
    ["I'm a Rolling", 'im-a-rolling'],
    ['A Great Camp-meeting in the Promised Land', 'a-great-camp-meeting-in-the-promised-land'],
    ['Weary Traveller', 'weary-traveller'],
    ['Do Bana Coba', 'do-bana-coba'],
  ])('slugifies %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('produces only lowercase letters, digits and hyphens', () => {
    const s = slugify("Nobody Knows the Trouble I've Seen");
    expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it('never produces a leading, trailing or doubled hyphen', () => {
    expect(slugify('  My Way\'s Cloudy!  ')).toBe('my-ways-cloudy');
    expect(slugify('The Rocks -- and the Mountains')).toBe('the-rocks-and-the-mountains');
  });

  it('drops a typographic apostrophe the same way as a straight one', () => {
    // songs.yaml is hand-edited, so a curly quote will arrive sooner or later.
    expect(slugify('My Way’s Cloudy')).toBe('my-ways-cloudy');
  });

  it('strips combining accents rather than hyphenating them', () => {
    expect(slugify('Cróuche')).toBe('crouche');
  });
});
