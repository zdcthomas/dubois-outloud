import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseItem, stripHtml } from '../scripts/lib/loc-parse.mjs';

const load = (id: string) =>
  JSON.parse(readFileSync(`tests/fixtures/loc/${id}.json`, 'utf8'));

describe('parseItem', () => {
  it('reads the 1917 Jukebox spiritual', () => {
    const r = parseItem(load('jukebox-879940'), 'jukebox-879940')!;
    expect(r.title).toBe("Nobody knows de trouble I've seen");
    expect(r.date).toBe('1917-11-21');
    expect(r.duration_seconds).toBe(186);
    expect(r.audio_url).toMatch(/^https:\/\/tile\.loc\.gov\/.*\.mp3$/);
    expect(r.can_download).toBe(true);
    expect(r.collections).toContain('national jukebox');
    expect(r.item_url).toBe('https://www.loc.gov/item/jukebox-879940/');
  });

  it('reads the 1909 Jukebox Swing Low', () => {
    const r = parseItem(load('jukebox-128141'), 'jukebox-128141')!;
    expect(r.title).toBe('Swing low, sweet chariot');
    expect(r.date).toBe('1909-12-01');
    expect(r.duration_seconds).toBe(180);
    expect(r.collections).toContain('national jukebox');
  });

  it('reads the 1939 Lomax field recording', () => {
    const r = parseItem(load('lomaxbib000533'), 'lomaxbib000533')!;
    expect(r.title).toBe("My Lord, What a Mornin'");
    expect(r.date).toBe('1939-06-11');
    expect(r.audio_url).toMatch(/\.mp3$/);
    expect(r.rights).toMatch(/not aware of any U\.S\. copyright/i);
  });

  it('prefers a downloadable resource over a restricted one', () => {
    // The Lomax item exposes one resource with canDownload false and another
    // with canDownload true. We must land on the true one, or delivery:
    // selfhost would promise a file we are not allowed to copy.
    const r = parseItem(load('lomaxbib000533'), 'lomaxbib000533')!;
    expect(r.can_download).toBe(true);
  });

  it('always returns an array of performers', () => {
    for (const id of ['jukebox-879940', 'jukebox-128141', 'lomaxbib000533']) {
      const r = parseItem(load(id), id)!;
      expect(Array.isArray(r.performers)).toBe(true);
    }
  });

  it('returns an audio_url that is an absolute https url', () => {
    for (const id of ['jukebox-879940', 'jukebox-128141', 'lomaxbib000533']) {
      const r = parseItem(load(id), id)!;
      // locSchema requires a parseable URL, so a relative path would fail the
      // build later rather than here.
      expect(() => new URL(r.audio_url!)).not.toThrow();
      expect(r.audio_url).toMatch(/^https:/);
    }
  });

  it('reports every collection an item belongs to, not just the first', () => {
    // loc.gov returns partof as objects, and the rights-bearing collection is
    // never first: the 1917 Jukebox item lists a UCSB department first and
    // "national jukebox" second, and the Lomax item lists four others before
    // "american folklife center". Keeping only partof[0] discards the single
    // fact the rights rule needs.
    const jukebox = parseItem(load('jukebox-879940'), 'jukebox-879940')!;
    expect(jukebox.collections.length).toBeGreaterThan(1);
    expect(jukebox.collections).toContain('national jukebox');

    const lomax = parseItem(load('lomaxbib000533'), 'lomaxbib000533')!;
    expect(lomax.collections).toContain('american folklife center');
  });

  it('keeps collection as a single readable name for display', () => {
    const r = parseItem(load('jukebox-879940'), 'jukebox-879940')!;
    expect(typeof r.collection).toBe('string');
    expect(r.collection).not.toMatch(/\[object/);
  });

  it('names the performers, properly cased, for citation', () => {
    // contributor_names is the only key carrying real capitalisation. The
    // contributor_* arrays are lowercased ("seagle, oscar"), which is no good
    // on a page a student is meant to cite.
    const r = parseItem(load('jukebox-879940'), 'jukebox-879940')!;
    expect(r.performers).toContain('Seagle, Oscar');
  });

  it('credits the ensemble, not only the individual singers', () => {
    const r = parseItem(load('jukebox-128141'), 'jukebox-128141')!;
    expect(r.performers).toContain('Fisk University Jubilee Singers');
  });

  it('leaves out arrangers and collectors, who did not perform', () => {
    // The 1917 side credits H. T. Burleigh as arranger; the Lomax item credits
    // John and Ruby Lomax as collectors. Naming a collector as the performer
    // would misattribute the singing to the folklorist who recorded it.
    const jukebox = parseItem(load('jukebox-879940'), 'jukebox-879940')!;
    expect(jukebox.performers.join(' ')).not.toMatch(/Burleigh/i);

    const lomax = parseItem(load('lomaxbib000533'), 'lomaxbib000533')!;
    expect(lomax.performers.join(' ')).not.toMatch(/Lomax/i);
  });

  it('finds performers on a Folklife item, which uses a different key shape', () => {
    const r = parseItem(load('lomaxbib000533'), 'lomaxbib000533')!;
    expect(r.performers.length).toBeGreaterThan(0);
    expect(r.performers).toContain('Unidentified singers');
  });

  it('strips the role suffix from every performer name', () => {
    for (const id of ['jukebox-879940', 'jukebox-128141', 'lomaxbib000533']) {
      const r = parseItem(load(id), id)!;
      for (const name of r.performers) {
        expect(name).not.toMatch(/ -- /);
        expect(name).not.toMatch(/\((?:Performer|Collector|Arranger)\)/i);
      }
    }
  });

  it('returns every field locSchema requires', () => {
    const r = parseItem(load('jukebox-879940'), 'jukebox-879940')!;
    for (const key of ['title', 'date', 'collection', 'performers', 'place',
                       'duration_seconds', 'audio_url', 'can_download',
                       'rights', 'item_url']) {
      expect(r).toHaveProperty(key);
    }
  });
});

describe('parseItem with no audio', () => {
  it('returns null for an item that exposes only images', () => {
    expect(parseItem(load('no-audio'), 'no-audio')).toBeNull();
  });

  it('returns null for an item with no resources key at all', () => {
    expect(parseItem({ item: { title: 'Gone' } }, 'gone')).toBeNull();
  });

  it('returns null for an empty resources array', () => {
    expect(parseItem({ item: { title: 'Gone' }, resources: [] }, 'gone')).toBeNull();
  });

  it('never returns the string "undefined" as an audio_url', () => {
    const odd = { item: { title: 'Odd' }, resources: [{ audio: '' }] };
    expect(parseItem(odd, 'odd')).toBeNull();
  });

  it('returns null rather than throwing on an empty object', () => {
    expect(parseItem({}, 'empty')).toBeNull();
  });
});

describe('stripHtml', () => {
  it('removes the markup loc.gov wraps rights statements in', () => {
    expect(stripHtml('<p>No known restrictions.</p>')).toBe('No known restrictions.');
  });

  it('decodes the entities that appear in loc.gov metadata', () => {
    expect(stripHtml('Sony &amp; EMI')).toBe('Sony & EMI');
    expect(stripHtml('Fisk&rsquo;s quartet')).toBe("Fisk's quartet");
  });

  it('collapses the whitespace that removing tags leaves behind', () => {
    expect(stripHtml('<p>One</p>\n<p>Two</p>')).toBe('One Two');
  });

  it('leaves no angle bracket behind that could open a tag', () => {
    expect(stripHtml('<script>alert(1)</script>ok')).not.toMatch(/[<>]/);
  });

  it('yields a rights string with no markup for every real fixture', () => {
    for (const id of ['jukebox-879940', 'jukebox-128141', 'lomaxbib000533']) {
      const r = parseItem(load(id), id)!;
      expect(r.rights).not.toMatch(/[<>]/);
      expect(r.rights.length).toBeGreaterThan(20);
    }
  });

  it('keeps the Jukebox permission wording intact, since it is the paper trail', () => {
    // The about page quotes this verbatim, so stripping tags must not eat the
    // sentence that names the rightsholders.
    const r = parseItem(load('jukebox-879940'), 'jukebox-879940')!;
    expect(r.rights).toMatch(/permission from the rightsholders/i);
  });
});
