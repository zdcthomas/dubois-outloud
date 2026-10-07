import { readManifest, refreshEntry, writeManifest } from './lib/manifest.mjs';
import { parseItem } from './lib/loc-parse.mjs';
import { fetchJson } from './lib/http.mjs';

const MANIFEST = 'src/data/recordings.yaml';

/**
 * The refresh pass. Re-reads every entry's metadata from loc.gov and rewrites
 * only the `loc:` block, leaving status, delivery and note alone.
 *
 * Kept separate from find-recordings.mjs on purpose: re-checking metadata and
 * dead audio URLs on recordings you already approved should not drop new
 * candidates into the same diff.
 */
async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const entries = readManifest(MANIFEST);
  const out = [];
  const unchecked = [];

  for (const entry of entries) {
    try {
      const json = await fetchJson(`https://www.loc.gov/item/${entry.loc_id}/?fo=json`);
      const parsed = parseItem(json, entry.loc_id);
      if (parsed === null) {
        unchecked.push(`${entry.loc_id}: item exposes no audio resource`);
      }
      out.push(refreshEntry(entry, parsed, today));
    } catch (err) {
      // The design is explicit: leave the existing loc block alone and report
      // which entries went unchecked, rather than aborting a long run.
      unchecked.push(`${entry.loc_id}: ${err.message}`);
      out.push({ ...entry });
    }
  }

  writeManifest(MANIFEST, out);

  const counts = { unreviewed: 0, approved: 0, rejected: 0 };
  for (const e of out) counts[e.status] += 1;
  console.log(
    `Refreshed ${out.length} entries: ${counts.approved} approved, ` +
      `${counts.unreviewed} unreviewed, ${counts.rejected} rejected.`,
  );

  if (unchecked.length > 0) {
    console.warn(`\n${unchecked.length} entries went unchecked:`);
    for (const line of unchecked) console.warn(`  - ${line}`);
    process.exitCode = 1;
  }
}

await main();
