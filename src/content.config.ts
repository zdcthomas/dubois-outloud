import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { parse } from 'yaml';
import { recordingSchema, songsSchema } from './schemas.ts';

// Tests point this at a fixture directory; a normal build reads src/data.
const DATA_DIR = process.env.DUBOIS_DATA_DIR ?? 'src/data';

// The file() loader requires an `id` on every entry, so each parser maps one
// on. Astro's docs show a bare `parser: (text) => ...`; without the id mapping
// the collection loads as a single opaque entry.
//
// Cross-entry validation is deliberately NOT here. The file() loader catches
// whatever its parser throws and finishes the build anyway, so a gate in a
// parser cannot fail a build. It lives in the integration in astro.config.mjs
// — see src/manifest-gate.ts.
const songs = defineCollection({
  loader: file(`${DATA_DIR}/songs.yaml`, {
    parser: (text) => parse(text).map((s: { slug: string }) => ({ ...s, id: s.slug })),
  }),
  schema: songsSchema,
});

const recordings = defineCollection({
  loader: file(`${DATA_DIR}/recordings.yaml`, {
    parser: (text) =>
      (parse(text) ?? []).map((r: { loc_id: string }, i: number) => ({
        ...r,
        id: `${r.loc_id}-${i}`,
      })),
  }),
  schema: recordingSchema,
});

export const collections = { songs, recordings };
