/**
 * Propose a delivery mode from an item's rights statement, collections and date.
 *
 * This is the engineering rule from the design, section 3.1. It is not legal
 * advice, and it only ever proposes: scripts/fetch-loc.mjs writes the value
 * when the field is absent and never overwrites a human's choice.
 *
 * The 1923 boundary comes from the Music Modernization Act, which moved
 * pre-1923 sound recordings into the public domain. The Library's own National
 * Jukebox rights statement raises the Act, so a pre-1923 Jukebox side has a
 * defensible public-domain argument even though the Library hosts the
 * collection by permission from Sony and EMI.
 */

const PUBLIC_DOMAIN_BEFORE = 1923;

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
    const year = yearOf(loc.date);
    // No date means the boundary test cannot run, so take the cautious side.
    if (year !== null && year < PUBLIC_DOMAIN_BEFORE) return 'selfhost';
    return 'stream';
  }

  return 'stream';
}
