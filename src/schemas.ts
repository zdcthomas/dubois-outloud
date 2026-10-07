import { z } from 'zod';

/**
 * Schemas for the two hand-edited manifests.
 *
 * These live here rather than in content.config.ts so that tests can validate
 * the YAML directly. content.config.ts imports `astro:content`, a virtual
 * module that only exists inside an Astro build, so anything importing it is
 * unreachable from a plain Vitest run. `z` re-exported by astro:content IS
 * zod, so importing zod here behaves identically — and content.config.ts still
 * applies these schemas at build time, which is what the design requires.
 */

export const songsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  chapter: z.number().int().min(1).max(14),
  title: z.string().min(1),
  scan: z
    .object({
      ia_item: z.string().min(1),
      page: z.number().int().positive(),
      crop: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    })
    .nullable(),
});

export type Song = z.infer<typeof songsSchema>;

/**
 * Frontmatter on the chapter files scripts/fetch-text.mjs writes.
 * `chapter` is null for the Forethought and the Afterthought, which carry no
 * number and no song.
 */
export const chaptersSchema = z.object({
  heading: z.string().min(1),
  chapter: z.number().int().min(1).max(14).nullable(),
  source: z.string(),
});

/** The block scripts/fetch-loc.mjs owns. A human never hand-edits this. */
export const locSchema = z.object({
  title: z.string().min(1),
  date: z.string().nullable(),
  // `collection` is the display name. `collections` holds every collection the
  // item belongs to, which is what the delivery rule reads: loc.gov does not
  // put the rights-bearing collection first. Defaults to [] so manifests
  // written before the field existed still validate.
  collection: z.string().nullable(),
  collections: z.array(z.string()).default([]),
  performers: z.array(z.string()),
  place: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  audio_url: z.string().url().nullable(),
  can_download: z.boolean(),
  rights: z.string(),
  item_url: z.string().url(),
  checked: z.string(),
});

export const recordingSchema = z.object({
  song: z.string().regex(/^[a-z0-9-]+$/),
  loc_id: z.string().min(1),
  status: z.enum(['unreviewed', 'approved', 'rejected']),
  delivery: z.enum(['selfhost', 'stream']).nullable(),
  note: z.string().nullable(),
  loc: locSchema.nullable(),
});

export type Recording = z.infer<typeof recordingSchema>;

/**
 * Cross-entry rules Zod cannot express on its own. Every message names the
 * loc_id, because the person reading a failed build needs to find the line.
 *
 * The design is deliberate that an approved recording with a dead audio_url
 * fails the build: a silent gap in a lesson is worse than a failed deploy.
 *
 * This runs from the recordings loader in content.config.ts. Astro's per-entry
 * `schema` cannot reach any of these rules, so if that call ever goes away,
 * this function is dead code and the build stops refusing broken manifests.
 */
export function validateManifest(recordings: unknown[], songSlugs: string[]): void {
  const slugs = new Set(songSlugs);
  const seen = new Map<string, string>();

  for (const raw of recordings) {
    const r = recordingSchema.parse(raw);
    const where = `recordings.yaml entry ${r.loc_id}`;

    // Checked for every status: a typo in `song` is a typo whether or not
    // anyone approved the entry yet, and catching it only on approval would
    // hide it until the day someone does.
    if (!slugs.has(r.song)) {
      throw new Error(`${where}: song "${r.song}" is not a slug in songs.yaml`);
    }

    const dup = seen.get(r.loc_id);
    if (dup !== undefined) {
      throw new Error(
        `${where}: duplicate loc_id, already used by the entry for song "${dup}"`,
      );
    }
    seen.set(r.loc_id, r.song);

    if (r.status === 'approved') {
      if (!r.loc) {
        throw new Error(`${where}: approved but has no loc block; run pnpm fetch:loc`);
      }
      if (!r.loc.audio_url) {
        throw new Error(`${where}: approved but loc.audio_url is empty`);
      }
      if (!r.delivery) {
        throw new Error(`${where}: approved but delivery is not set`);
      }
      if (r.delivery === 'selfhost' && !r.loc.can_download) {
        throw new Error(
          `${where}: delivery is selfhost but loc.can_download is false; ` +
            `use delivery: stream`,
        );
      }
    }
  }
}
