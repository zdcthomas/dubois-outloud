import { readManifest } from './lib/manifest.mjs';

/**
 * Print the unreviewed candidates in something a person can actually read.
 *
 * The manifest is the source of truth, but 150 entries of YAML is not a
 * review surface. This is read-only: it never writes, so it is safe to run
 * while deciding.
 *
 *   node scripts/candidates.mjs              # everything unreviewed
 *   node scripts/candidates.mjs steal-away   # one song
 *   node scripts/candidates.mjs --approved   # what is already in
 */
const MANIFEST = `${process.env.DUBOIS_DATA_DIR ?? 'src/data'}/recordings.yaml`;

const args = process.argv.slice(2);
const wantStatus = args.includes('--approved') ? 'approved'
  : args.includes('--rejected') ? 'rejected'
  : 'unreviewed';
const songFilter = args.find((a) => !a.startsWith('--'));

const entries = readManifest(MANIFEST).filter(
  (e) => e.status === wantStatus && (!songFilter || e.song === songFilter),
);

if (entries.length === 0) {
  console.log(`No ${wantStatus} entries${songFilter ? ` for ${songFilter}` : ''}.`);
  process.exit(0);
}

const bySong = new Map();
for (const e of entries) bySong.set(e.song, [...(bySong.get(e.song) ?? []), e]);

const mmss = (s) =>
  s === null || s === undefined ? '    ' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

for (const [song, list] of [...bySong].sort()) {
  console.log(`\n${song}  (${list.length})`);
  for (const e of list) {
    if (!e.loc) {
      console.log(`  ${e.loc_id.padEnd(18)} — no metadata yet, run: pnpm fetch:loc`);
      continue;
    }
    const year = e.loc.date ? String(e.loc.date).slice(0, 4) : '????';
    const who = e.loc.performers[0] ?? 'performer unnamed';
    // `delivery` is only a proposal until a human approves the entry.
    const mode = e.delivery ?? '?';
    console.log(
      `  ${e.loc_id.padEnd(18)} ${year}  ${mmss(e.loc.duration_seconds)}  ` +
        `${mode.padEnd(8)} ${who.slice(0, 34).padEnd(34)} ${e.loc.item_url}`,
    );
  }
}

console.log(
  `\n${entries.length} ${wantStatus}. To keep one, set its status to approved ` +
    `in ${MANIFEST} and write a note.`,
);
