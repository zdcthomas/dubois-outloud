import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { proposeDelivery } from '../scripts/lib/rights.mjs';
import { parseItem } from '../scripts/lib/loc-parse.mjs';

const NO_RESTRICTIONS =
  'The Library of Congress is not aware of any U.S. copyright protection ' +
  '(see Title 17, U.S.C.) or any other restrictions in the material in this collection.';
const JUKEBOX =
  'The Library makes the sound recordings in the National Jukebox available ' +
  'pursuant to permission from the rightsholders. Under the Music Modernization Act, ' +
  'many of these recordings will begin entering the public domain.';

describe('proposeDelivery', () => {
  it('self-hosts a no-known-restrictions field recording', () => {
    expect(proposeDelivery({
      collection: 'lomax collection', date: '1939-06-11',
      can_download: true, rights: NO_RESTRICTIONS,
    })).toBe('selfhost');
  });

  it('self-hosts a pre-1923 Jukebox side on Music Modernization Act grounds', () => {
    expect(proposeDelivery({
      collection: 'national jukebox', date: '1909-12-01',
      can_download: true, rights: JUKEBOX,
    })).toBe('selfhost');
    expect(proposeDelivery({
      collection: 'national jukebox', date: '1917-11-21',
      can_download: true, rights: JUKEBOX,
    })).toBe('selfhost');
  });

  it('streams a 1923-or-later Jukebox side', () => {
    expect(proposeDelivery({
      collection: 'national jukebox', date: '1923-01-02',
      can_download: true, rights: JUKEBOX,
    })).toBe('stream');
    expect(proposeDelivery({
      collection: 'national jukebox', date: '1935-04-01',
      can_download: true, rights: JUKEBOX,
    })).toBe('stream');
  });

  it('streams anything that cannot be downloaded, whatever the rights say', () => {
    expect(proposeDelivery({
      collection: 'lomax collection', date: '1939-06-11',
      can_download: false, rights: NO_RESTRICTIONS,
    })).toBe('stream');
  });

  it('streams when the date is missing, because the 1923 test cannot run', () => {
    expect(proposeDelivery({
      collection: 'national jukebox', date: null,
      can_download: true, rights: JUKEBOX,
    })).toBe('stream');
  });

  it('streams when the rights statement is empty', () => {
    expect(proposeDelivery({
      collection: 'something', date: '1910', can_download: true, rights: '',
    })).toBe('stream');
  });

  it('reads a bare year as a date', () => {
    expect(proposeDelivery({
      collection: 'national jukebox', date: '1912',
      can_download: true, rights: JUKEBOX,
    })).toBe('selfhost');
  });

  it('treats 1922 as inside the public domain and 1923 as outside', () => {
    const at = (date: string) => proposeDelivery({
      collection: 'national jukebox', date, can_download: true, rights: JUKEBOX,
    });
    expect(at('1922-12-31')).toBe('selfhost');
    expect(at('1923-01-01')).toBe('stream');
  });

  it('defaults an unrecognised collection with no clear rights to stream', () => {
    expect(proposeDelivery({
      collection: 'some other collection', date: '1950',
      can_download: true, rights: 'Rights status unevaluated.',
    })).toBe('stream');
  });
});

describe('proposeDelivery reads the collections array', () => {
  // loc.gov never puts the rights-bearing collection first, so the rule must
  // look at all of them. `collection` alone would miss it.
  it('finds National Jukebox when it is not the first collection', () => {
    expect(proposeDelivery({
      collection: 'department of special collections, davidson library',
      collections: [
        'department of special collections, davidson library',
        'national jukebox',
        'recorded sound research center',
      ],
      date: '1917-11-21', can_download: true, rights: JUKEBOX,
    })).toBe('selfhost');
  });

  it('streams a post-1923 Jukebox side found deep in the array', () => {
    expect(proposeDelivery({
      collection: 'recorded sound section, library of congress',
      collections: ['recorded sound section, library of congress', 'national jukebox'],
      date: '1930-05-05', can_download: true, rights: JUKEBOX,
    })).toBe('stream');
  });

  it('works when collections is absent, for a manifest written before the field', () => {
    expect(proposeDelivery({
      collection: 'national jukebox', date: '1909-12-01',
      can_download: true, rights: JUKEBOX,
    })).toBe('selfhost');
  });

  it('works when collections is an empty array', () => {
    expect(proposeDelivery({
      collection: null, collections: [], date: '1939-06-11',
      can_download: true, rights: NO_RESTRICTIONS,
    })).toBe('selfhost');
  });
});

describe('proposeDelivery against real loc.gov items', () => {
  const load = (id: string) =>
    parseItem(JSON.parse(readFileSync(`tests/fixtures/loc/${id}.json`, 'utf8')), id)!;

  it('self-hosts the 1917 Jukebox side', () => {
    expect(proposeDelivery(load('jukebox-879940'))).toBe('selfhost');
  });

  it('self-hosts the 1909 Jukebox side', () => {
    expect(proposeDelivery(load('jukebox-128141'))).toBe('selfhost');
  });

  it('self-hosts the 1939 Lomax field recording', () => {
    expect(proposeDelivery(load('lomaxbib000533'))).toBe('selfhost');
  });

  it('decides each of the three without reading the rights prose', () => {
    // The structured collections array should be enough on its own. If this
    // ever fails, the rule has quietly become dependent on LoC's wording.
    for (const id of ['jukebox-879940', 'jukebox-128141', 'lomaxbib000533']) {
      const loc = load(id);
      expect(proposeDelivery({ ...loc, rights: '' })).toBe('selfhost');
    }
  });
});
