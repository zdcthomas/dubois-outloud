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
export function newCandidates(results, songSlug, existingIds) {
  const out = [];
  const seen = new Set(existingIds);
  for (const result of results) {
    if (!isAudio(result)) continue;
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
    const candidates = newCandidates(results, song.slug, existingIds);
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
