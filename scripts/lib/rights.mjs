/**
 * Propose a delivery mode from an item's rights statement, collections and date.
 *
 * This is the engineering rule from the design, section 3.1. It is not legal
 * advice, and it only ever proposes: scripts/fetch-loc.mjs writes the value
 * when the field is absent and never overwrites a human's choice.
 *
 * Whether a recording is out of copyright comes from isPublicDomain below,
 * which computes the Music Modernization Act's term. The Library's own
 * National Jukebox statement raises the Act, so a side whose term has expired
 * has a defensible public-domain argument even though the Library hosts the
 * collection by permission from Sony and EMI.
 *
 * Do not reintroduce a literal cutoff year anywhere. The term moves every
 * January, and a copy of it in another file is how the vetting page ended up
 * warning about recordings that were already public domain.
 */

/**
 * Is a sound recording published in `year` in the US public domain?
 *
 * The Music Modernization Act's schedule, as the Library of Congress states
 * it: everything published before 1923 entered the public domain on
 * 1 January 2022; 1923-1946 is protected for 100 years; 1947-1956 for 110;
 * and anything later stays protected until 15 February 2067.
 *
 * The 1923-1946 band is a ROLLING term, not a fixed line, and that is the
 * point of this function. A hardcoded `year < 1923` test was correct when
 * written and silently gets more conservative every January — it was already
 * holding back a 1924 recording that entered the public domain on
 * 1 January 2025.
 *
 * `now` is injected so the tests can pin a year instead of drifting.
 */
export function isPublicDomain(year, now = new Date().getUTCFullYear()) {
  if (!Number.isFinite(year)) return false;
  if (year < 1923) return true;
  if (year <= 1946) return now > year + 100;
  if (year <= 1956) return now > year + 110;
  // 15 February 2067 for everything from 1957 to the federal cutover.
  return now > 2067;
}

const NO_KNOWN_RESTRICTIONS =
  /not aware of any (?:U\.S\.\s*)?copyright|no known restrictions/i;

const FOLKLIFE = /american folklife center/i;
const JUKEBOX = /national jukebox/i;

function yearOf(date) {
  if (!date) return null;
  const m = String(date).match(/\b(1[89]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Collection names to test. loc.gov returns several per item and never puts
 * the rights-bearing one first, so all of them are checked. `collection`
 * alone is kept in the list for manifests written before `collections`
 * existed.
 */
function collectionNames(loc) {
  return [...(loc.collections ?? []), loc.collection ?? ''].filter(Boolean);
}

export function proposeDelivery(loc) {
  // A resource we cannot download cannot be self-hosted, whatever its rights.
  if (!loc.can_download) return 'stream';

  const rights = loc.rights ?? '';
  const names = collectionNames(loc);

  // Folklife Center material carries a no-known-restrictions statement. Match
  // the collection as well as the prose so the decision rests on structured
  // metadata rather than on LoC's current wording.
  if (names.some((n) => FOLKLIFE.test(n))) return 'selfhost';
  if (NO_KNOWN_RESTRICTIONS.test(rights)) return 'selfhost';

  if (names.some((n) => JUKEBOX.test(n)) || JUKEBOX.test(rights)) {
    // No date means the term cannot be computed, so take the cautious side.
    return isPublicDomain(yearOf(loc.date)) ? 'selfhost' : 'stream';
  }

  return 'stream';
}
