import { describe, expect, it } from 'vitest';
import { creditLine } from '../src/credit.ts';

describe('creditLine', () => {
  it('leads with the ensemble when one is credited', () => {
    // loc.gov lists individual singers before the group they sang in, so
    // taking the first name buries the citable one. This is the 1909 Swing
    // Low side: the Fisk Jubilee Singers are the name a student should cite,
    // and the name Du Bois knew.
    expect(creditLine([
      'Myers, J. A.', 'Fisk University Jubilee Singers', 'Work, John Wesley',
      'Ryder, Noah Walker', 'King, Alfred Garfield',
    ])).toBe('Fisk University Jubilee Singers and 4 others');
  });

  it('says "1 other", not "1 others"', () => {
    expect(creditLine(['Unidentified singers', 'Coson, Anna F.']))
      .toBe('Unidentified singers and 1 other');
  });

  it('names a lone performer with no suffix', () => {
    expect(creditLine(['Seagle, Oscar'])).toBe('Seagle, Oscar');
  });

  it('falls back when nobody is named', () => {
    expect(creditLine([])).toBe('performer unnamed');
  });

  it('recognises the ensemble words loc.gov actually uses', () => {
    for (const group of ['Tuskegee Institute Singers', 'Hampton Quartet',
                         'New Zion Baptist Church Congregation', 'Jubilee Chorus',
                         'Dinwiddie Colored Quartet']) {
      expect(creditLine(['Smith, John', group])).toBe(`${group} and 1 other`);
    }
  });

  it('keeps the first name when no ensemble is credited', () => {
    expect(creditLine(['Smith, John', 'Jones, Mary'])).toBe('Smith, John and 1 other');
  });

  it('picks the first ensemble when several are credited', () => {
    expect(creditLine(['Smith, John', 'Fisk Singers', 'Hampton Singers']))
      .toBe('Fisk Singers and 2 others');
  });
});
