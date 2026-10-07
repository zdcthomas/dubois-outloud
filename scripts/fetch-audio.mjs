import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { readManifest } from './lib/manifest.mjs';
import { fetchBinary } from './lib/http.mjs';

const MANIFEST = 'src/data/recordings.yaml';
const OUT_DIR = 'public/audio';

// Below this, the body is an error page or a stub rather than a recording.
const MIN_BYTES = 1024;

/**
 * The song slug alone would collide when a chapter offers several performances
 * of one spiritual, so the LoC item id goes in too. The name is stable, which
 * is what lets nginx serve these with a long immutable cache header: a
 * different recording is a different filename.
 */
export function audioFilename(entry) {
  return `${entry.song}--${entry.loc_id}.mp3`;
}

/**
 * The design forbids shipping a silent file, so a short body is a hard error
 * rather than a warning. loc.gov occasionally answers 200 with an HTML error
 * page, which is why the floor is checked even when no length is declared.
 */
export function checkDownload(buf, declared, url) {
  if (buf.length === 0) throw new Error(`Downloaded an empty body from ${url}`);
  if (declared !== null && buf.length < declared) {
    throw new Error(
      `Truncated download from ${url}: got ${buf.length} bytes, ` +
        `server declared ${declared}`,
    );
  }
  if (buf.length < MIN_BYTES) {
    throw new Error(
      `Body from ${url} is too small to be a recording: ${buf.length} bytes`,
    );
  }
}

async function main() {
  const entries = readManifest(MANIFEST).filter(
    (e) => e.status === 'approved' && e.delivery === 'selfhost',
  );
  mkdirSync(OUT_DIR, { recursive: true });

  let fetched = 0;
  let skipped = 0;
  const failures = [];

  for (const entry of entries) {
    const target = `${OUT_DIR}/${audioFilename(entry)}`;
    try {
      if (statSync(target).size >= MIN_BYTES) {
        skipped += 1;
        continue;
      }
    } catch {
      // Not present yet; fall through and download it.
    }
    try {
      const { buf, declared } = await fetchBinary(entry.loc.audio_url);
      checkDownload(buf, declared, entry.loc.audio_url);
      writeFileSync(target, buf);
      fetched += 1;
      console.log(`  ${audioFilename(entry)}  ${(buf.length / 1e6).toFixed(1)} MB`);
    } catch (err) {
      failures.push(`${entry.loc_id}: ${err.message}`);
    }
  }

  console.log(`Fetched ${fetched}, already present ${skipped}, of ${entries.length}.`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} downloads failed:`);
    for (const line of failures) console.error(`  - ${line}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
