import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { validateManifest } from './schemas.ts';

/**
 * The build-time gate on the two manifests.
 *
 * This runs as an Astro integration hook, NOT inside the content collection's
 * loader. That is a correctness requirement, not a style choice: Astro's
 * file() loader catches whatever its parser throws, reports it as a non-fatal
 * `[file-loader] Error reading data from ...`, loads the collection as empty,
 * and finishes the build with exit 0. A gate there cannot fail a build, which
 * is the one thing the design needs it to do. An exception from an integration
 * hook aborts the build.
 *
 * Checked here rather than by Astro's per-entry `schema`, because every rule
 * is a cross-entry one: an orphan song slug, a duplicate loc_id, or an
 * approved recording with a dead audio_url can only be seen with the whole
 * array in hand.
 */
export function checkManifests(dataDir: string): { unreviewed: number; total: number } {
  const songs = parse(readFileSync(`${dataDir}/songs.yaml`, 'utf8')) ?? [];
  const recordings = parse(readFileSync(`${dataDir}/recordings.yaml`, 'utf8')) ?? [];

  const songSlugs: string[] = songs.map((s: { slug: string }) => s.slug);
  validateManifest(recordings, songSlugs);

  const unreviewed = recordings.filter(
    (r: { status: string }) => r.status === 'unreviewed',
  ).length;

  return { unreviewed, total: recordings.length };
}

/** Astro integration wrapper. Throwing from this hook aborts the build. */
export function manifestGate(dataDir: string) {
  return {
    name: 'dubois-manifest-gate',
    hooks: {
      'astro:config:setup': ({ logger }: { logger: { info: (m: string) => void } }) => {
        const { unreviewed, total } = checkManifests(dataDir);
        logger.info(`${total} recordings in the manifest, ${unreviewed} still unreviewed`);
        if (unreviewed > 0) {
          logger.info('Unreviewed entries are excluded from the site until you approve them.');
        }
      },
    },
  };
}
