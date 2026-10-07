/**
 * Turn a list of performer credits into one citation line.
 *
 * loc.gov lists individual singers before the group they sang in, so taking
 * the first name buries the one a student should cite. The 1909 Swing Low
 * side credits five people, with "Fisk University Jubilee Singers" second —
 * and that is the name Du Bois knew and the name worth citing.
 */

const ENSEMBLE =
  /\b(singers|quartets?|quintets?|choir|chorus|congregation|group|band|ensemble|jubilee|company|troupe)\b/i;

export function creditLine(performers: string[]): string {
  if (performers.length === 0) return 'performer unnamed';

  const lead = performers.find((name) => ENSEMBLE.test(name)) ?? performers[0];
  const others = performers.length - 1;
  if (others === 0) return lead;
  return `${lead} and ${others} ${others === 1 ? 'other' : 'others'}`;
}
