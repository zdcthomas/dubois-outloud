import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { readManifest, writeManifest } from './lib/manifest.mjs';
import { fetchJson } from './lib/http.mjs';

const DATA_DIR = process.env.DUBOIS_DATA_DIR ?? 'src/data';
const SONGS = `${DATA_DIR}/songs.yaml`;
const MANIFEST = `${DATA_DIR}/recordings.yaml`;

export function idFromResult(result) {
  const m = String(result.id ?? '').match(/\/item\/([^/]+)\/?$/);
  return m ? m[1] : null;
}

// Words too common to identify a song. Only stripped from the SONG side, so a
// dialect filler word in a record's title never hurts it.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'in', 'of', 'on', 'to', 'and', 'or', 'is', 'it', 'be',
  'for', 'at', 'by', 'with', 'that', 'this', 'my', 'your', 'there', 'will',
  'shall',
]);

const words = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Does this record's title plausibly name the spiritual we searched for?
 *
 * loc.gov's `q` searches full text, so it matches interview transcripts: a
 * first pass on these eighteen songs produced 147 candidates of which a
 * reviewer rejected 79 of the 80 that had metadata — COVID oral histories,
 * veterans interviews, a press-club speech, and for "March On" a long run of
 * Sousa marches. Filtering on the title is what makes the search usable.
 *
 * Partial overlap rather than exact match, because these titles vary wildly in
 * spelling: the record for "My Lord, What a Mourning" is catalogued as
 * "My Lord, What a Mornin'". Two of its three significant words line up, which
 * is enough.
 *
 * A song whose significant words reduce to one — "March On" — gets a stricter
 * phrase test instead. Scoring a single common word would readmit every march
 * in the catalogue.
 */
export function titleMatches(songTitle, recordTitle) {
  const have = words(recordTitle);
  if (have.length === 0) return false;

  const want = words(songTitle).filter((w) => w.length > 1 && !STOPWORDS.has(w));
  if (want.length === 0) return false;

  if (want.length === 1) {
    const phrase = words(songTitle).join(' ');
    return have.join(' ').includes(phrase);
  }

  // A word counts if it appears, or shares a four-character stem — enough for
  // "traveller"/"traveler" without letting unrelated words through.
  const matched = want.filter((w) =>
    have.some((h) => h === w || (w.length >= 4 && h.length >= 4 && h.slice(0, 4) === w.slice(0, 4))),
  ).length;

  return matched >= 2 && matched / want.length >= 0.6;
}

function isAudio(result) {
  const formats = result.online_format ?? [];
  return Array.isArray(formats) ? formats.includes('audio') : formats === 'audio';
}

/**
 * Search results -> unreviewed manifest entries.
 *
 * `existingIds` is every loc_id already in the manifest, including the
 * rejected ones. Skipping those is what makes a re-run safe: a recording
 * someone already turned down must not come back as a fresh candidate.
 */
export function newCandidates(results, songSlug, existingIds, songTitle) {
  const out = [];
  const seen = new Set(existingIds);
  for (const result of results) {
    if (!isAudio(result)) continue;
    // songTitle is optional so older callers keep working, but without it the
    // title filter is off and the search readmits every oral history.
    if (songTitle && !titleMatches(songTitle, result.title)) continue;
    const locId = idFromResult(result);
    if (locId === null || seen.has(locId)) continue;
    seen.add(locId);
    out.push({
      song: songSlug, loc_id: locId, status: 'unreviewed',
      delivery: null, note: null, loc: null,
    });
  }
  return out;
}

async function main() {
  const songs = parse(readFileSync(SONGS, 'utf8'));
  const manifest = readManifest(MANIFEST);
  const existingIds = new Set(manifest.map((e) => e.loc_id));

  let added = 0;
  for (const song of songs) {
    const query = encodeURIComponent(song.title.replace(/['"]/g, ''));
    const url = `https://www.loc.gov/audio/?q=${query}&fo=json&c=20&at=results`;
    let results = [];
    try {
      results = (await fetchJson(url)).results ?? [];
    } catch (err) {
      console.warn(`  ${song.slug}: search failed, ${err.message}`);
      continue;
    }
    const candidates = newCandidates(results, song.slug, existingIds, song.title);
    for (const c of candidates) existingIds.add(c.loc_id);
    manifest.push(...candidates);
    added += candidates.length;
    console.log(`  ${song.slug}: ${candidates.length} new of ${results.length} results`);
  }

  writeManifest(MANIFEST, manifest);
  console.log(
    `\nAdded ${added} candidates, all status: unreviewed.\n` +
      `Run \`pnpm fetch:loc\` to fill in their metadata, then vet them.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
