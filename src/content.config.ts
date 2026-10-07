import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { parse } from 'yaml';
import { songsSchema } from './schemas.ts';

// The file() loader requires an `id` on every entry, so the parser maps the
// song's own slug onto it. Astro's docs show a bare `parser: (text) => ...`;
// without the id mapping the collection loads as a single opaque entry.
const songs = defineCollection({
  loader: file('src/data/songs.yaml', {
    parser: (text) => parse(text).map((s: { slug: string }) => ({ ...s, id: s.slug })),
  }),
  schema: songsSchema,
});

export const collections = { songs };
