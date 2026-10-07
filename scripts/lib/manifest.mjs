import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { proposeDelivery } from './rights.mjs';

const HEADER = `# The vetting file. You own \`status\`, \`delivery\` and \`note\`.
# Scripts own the \`loc:\` block and never touch anything above it.
#
#   status:   unreviewed | approved | rejected
#   delivery: selfhost | stream
#
# Run \`pnpm fetch:loc\` to refresh metadata, \`pnpm find:recordings\` to add
# candidates, and \`pnpm fetch:audio\` to download what you approved.
#
# Per-entry commentary belongs in \`note\`, not in a YAML comment: the scripts
# rewrite this whole file, so a comment on a line would not survive.
`;

export function readManifest(path) {
  const parsed = parse(readFileSync(path, 'utf8'));
  return parsed ?? [];
}

/**
 * Rewrite the manifest. The header is re-emitted every time, and that is why
 * it tells the reader to keep commentary in `note`.
 */
export function writeManifest(path, entries) {
  writeFileSync(path, HEADER + stringify(entries, { lineWidth: 0 }));
}

/**
 * Refresh one entry from freshly parsed loc.gov metadata.
 *
 * This function is the guarantee the design makes to whoever is vetting:
 * `status` and `note` come back untouched, and `delivery` is only ever filled
 * in when it is null. `??` rather than `||` matters here — an empty-string
 * note is a human's deliberate choice and must survive.
 *
 * A null `parsed` means the item exposed no audio. We then keep whatever we
 * already had rather than overwriting good metadata with nothing.
 */
export function refreshEntry(entry, parsed, today) {
  if (parsed === null) return { ...entry };

  const loc = { ...parsed, checked: today };
  return {
    song: entry.song,
    loc_id: entry.loc_id,
    status: entry.status,
    delivery: entry.delivery ?? proposeDelivery(loc),
    note: entry.note ?? null,
    loc,
  };
}
