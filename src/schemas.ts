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
