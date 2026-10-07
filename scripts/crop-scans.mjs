import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import sharp from 'sharp';
import { fetchBinary } from './lib/http.mjs';

const SONGS = `${process.env.DUBOIS_DATA_DIR ?? 'src/data'}/songs.yaml`;
const OUT_DIR = 'src/assets/notation';

export const notationFilename = (slug) => `${slug}.png`;

/**
 * One page at a time through the Internet Archive IIIF endpoint. The
 * alternative is downloading the whole 288-page JP2 bundle — 109 MB — for the
 * fourteen pages we need.
 *
 * The page number is a 0-based leaf index, which is what IIIF expects after
 * the `$`. It is NOT the printed page number.
 */
export const iiifUrl = (iaItem, page) =>
  `https://iiif.archive.org/iiif/${iaItem}$${page}/full/full/0/default.jpg`;

/**
 * Crop one staff out of one page scan.
 *
 * Exported so `pnpm fetch:scans -- --probe <item> <page>` can write a whole
 * page out for inspection while someone works out a crop box.
 */
export async function cropStaff({ ia_item: iaItem, page, crop }) {
  if (!iaItem) throw new Error('scan.ia_item is missing');
  const { buf } = await fetchBinary(iiifUrl(iaItem, page));
  const meta = await sharp(buf).metadata();
  const [left, top, right, bottom] = crop;

  if (right > meta.width || bottom > meta.height || left < 0 || top < 0) {
    throw new Error(
      `crop [${crop}] falls outside the ${meta.width}x${meta.height} page ` +
        `${iaItem}$${page}`,
    );
  }

  return sharp(buf)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Write a full page out, so a human can read coordinates off it. */
async function probe(iaItem, page) {
  const { buf } = await fetchBinary(iiifUrl(iaItem, page));
  const meta = await sharp(buf).metadata();
  mkdirSync('.probe', { recursive: true });
  const out = `.probe/${iaItem}-${page}.png`;
  await sharp(buf).png().toFile(out);
  console.log(`${out}  ${meta.width}x${meta.height}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--probe') {
    await probe(args[1], Number(args[2]));
    return;
  }

  const songs = parse(readFileSync(SONGS, 'utf8')).filter((s) => s.scan !== null);
  mkdirSync(OUT_DIR, { recursive: true });

  if (songs.length === 0) {
    console.log(
      'No songs have scan coordinates yet, so there is nothing to crop.\n' +
        'Find a page with:  pnpm fetch:scans -- --probe cu31924024920492 16\n' +
        'then put its page index and crop box into src/data/songs.yaml.',
    );
    return;
  }

  const failures = [];
  for (const song of songs) {
    try {
      const png = await cropStaff(song.scan);
      writeFileSync(`${OUT_DIR}/${notationFilename(song.slug)}`, png);
      console.log(`  ${notationFilename(song.slug)}  page ${song.scan.page}`);
    } catch (err) {
      failures.push(`${song.slug} (page ${song.scan.page}): ${err.message}`);
    }
  }

  console.log(`Cropped ${songs.length - failures.length} of ${songs.length}.`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} crops failed:`);
    for (const line of failures) console.error(`  - ${line}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
