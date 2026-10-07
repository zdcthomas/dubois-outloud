# Du Bois Out Loud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static site that presents Du Bois' *The Souls of Black Folk* (1903) with vetted Library of Congress recordings of the sorrow song at each chapter head, and deploy it to fly.io on push to `main`.

**Architecture:** Astro renders static HTML from two hand-edited YAML manifests and a Markdown copy of the public-domain text. Five idempotent Node scripts fetch from Project Gutenberg, the Internet Archive, and the loc.gov JSON API; audio and cropped notation are build artifacts regenerated from the manifest, never committed. A Zod schema on an Astro content collection fails the build on a bad manifest.

**Tech Stack:** Nix flake (`nodejs_22`, `pnpm`, `flyctl`, `vips`), Astro, Zod, `sharp`, `yaml`, Vitest, Docker + nginx, fly.io, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-07-dubois-outloud-design.md`

## Global Constraints

- Node 22, ESM only. Every script is `scripts/*.mjs`.
- `pnpm` is the package manager. `pnpm-lock.yaml` is committed. Install with `--frozen-lockfile` in CI.
- Dependency versions are pinned exactly — no `^` or `~` ranges in `package.json`. The spec requires this for longevity.
- All work happens inside `nix develop`. `flyctl` and `vips` exist only there.
- Zero client-side JavaScript except one inline script that pauses other `<audio>` elements. No framework ships to the browser.
- Every loc.gov and archive.org request sends `User-Agent: dubois-outloud/1.0 (+https://github.com/<owner>/dubois-outloud; zach.thomas@hey.com)`, runs serially, and sleeps 250 ms between requests. Retry three times with exponential backoff.
- `public/audio/` and `src/assets/notation/` are gitignored build artifacts. `src/data/*.yaml` and `src/content/chapters/*.md` are source.
- No script ever writes `status`, `delivery`, or `note` on an existing manifest entry.
- Text source: `https://www.gutenberg.org/cache/epub/408/pg408.txt`
- Scan source: Internet Archive item `cu31924024920492` (Chicago, A. C. McClurg & Co., 1903, 288 page images), one page at a time via `https://iiif.archive.org/iiif/cu31924024920492$<page>/full/full/0/default.jpg`
- LoC item metadata: `https://www.loc.gov/item/<id>/?fo=json`
- LoC audio search: `https://www.loc.gov/audio/?q=<query>&fo=json&c=20&at=results`
- fly.io app name: `dubois-outloud`
- Never commit a real `FLY_API_TOKEN` to the repository.

## Review Focus

These input classes are implied by the spec but no task's main deliverable
exercises them. Each line names the test that pins it and the task that owns it.

1. **Apostrophes and commas in song titles** — every slug must be filename-safe and URL-safe. `"Nobody Knows the Trouble I've Seen"` and `"Children, You'll Be Called On"` both carry punctuation that breaks a path. Pinned in Task 2, Step 6.
2. **The LoC `rights` field contains HTML** — the real API returns `['<p>The Library makes…']`, an array of HTML strings. Rendering it raw injects markup into the page. Pinned in Task 6, Step 8.
3. **A duplicate `loc_id` in `recordings.yaml`** — `find-recordings.mjs` re-runs and must not append a candidate already present, and two entries for one recording must fail validation. Pinned in Task 3, Step 6 and Task 11, Step 2.
4. **A loc.gov item with no audio resource at all** — an item can be withdrawn or hold only images. The parser must return `null` rather than crash or emit `undefined` as a URL. Pinned in Task 6, Step 6.
5. **A truncated or zero-length MP3 download** — a build that ships a silent file is the exact failure the spec forbids. `fetch-audio.mjs` must check the byte length against `Content-Length` and fail. Pinned in Task 9, Step 1.

---

## File Structure

```
flake.nix                      Nix dev shell: nodejs_22, pnpm, flyctl, vips
flake.lock                     Pins nixpkgs
package.json                   Exact-pinned deps, scripts
pnpm-lock.yaml
astro.config.mjs               Astro config, site URL
tsconfig.json
vitest.config.ts

src/
  content.config.ts            Astro collections + Zod schemas for both manifests
  data/
    songs.yaml                 18 entries: slug, chapter, title, scan coords
    recordings.yaml            The vetting file
  content/chapters/            fetch-text.mjs output: 00.md … 15.md
  assets/notation/             crop-scans.mjs output (gitignored)
  layouts/Base.astro           Shell: head, skip link, nav, footer
  components/
    Epigraph.astro             Verse + notation image + caption
    RecordingList.astro        One <audio> per approved recording + citation
    audio-exclusive.ts         The only client script: pause the others
  pages/
    index.astro                Title page, Forethought, chapter list
    chapter/[n].astro          Chapters 1–14
    afterthought.astro
    songs.astro                Table of songs
    about.astro                Sources, citations, rights

scripts/
  lib/
    http.mjs                   UA, serial fetch, 250ms sleep, retry+backoff
    loc-parse.mjs              loc.gov JSON -> recording metadata
    rights.mjs                 The delivery rule
    manifest.mjs               Read/write recordings.yaml preserving human fields
    slug.mjs                   Title -> filename-safe slug
  fetch-text.mjs
  find-recordings.mjs
  fetch-loc.mjs
  fetch-audio.mjs
  crop-scans.mjs

tests/
  fixtures/loc/                Saved real loc.gov JSON responses
  fixtures/gutenberg/          Trimmed pg408.txt sample
  *.test.ts

Dockerfile                     nginx serving dist/
fly.toml                       dubois-outloud, 256MB, min_machines_running = 1
.dockerignore
.github/workflows/ci.yml
.github/workflows/fly-deploy.yml
```

---

### Task 1: Dev shell, Astro skeleton, and a green build

**Files:**
- Create: `flake.nix`, `.envrc`, `package.json`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `src/layouts/Base.astro`, `src/pages/index.astro`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: a `nix develop` shell with `node`, `pnpm`, `flyctl`, `vips`; the npm scripts `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm check`; and `Base.astro` exporting a layout that takes props `{ title: string, description?: string }`.

- [ ] **Step 1: Write `flake.nix`**

Follows the shape of `~/dev/name_that_tune/flake.nix`.

```nix
{
  description = "Du Bois Out Loud development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            pnpm
            flyctl
            # sharp builds against libvips rather than downloading a prebuilt
            # binary, which would not run on NixOS.
            vips
            pkg-config
          ];

          shellHook = ''
            echo "Du Bois Out Loud"
            echo "Node: $(node --version)  pnpm: $(pnpm --version)"
            echo ""
            echo "  pnpm install     - install dependencies"
            echo "  pnpm dev         - dev server"
            echo "  pnpm build       - build dist/"
            echo "  pnpm test        - run the test suite"
            echo "  pnpm check       - astro check (types + schema)"
            echo ""
          '';
        };
      }
    );
}
```

- [ ] **Step 2: Write `.envrc`**

```bash
use flake
```

- [ ] **Step 3: Enter the shell and lock it**

Run:
```bash
nix develop --command true && git add flake.nix flake.lock .envrc
```
Expected: `flake.lock` is created. No error.

- [ ] **Step 4: Write `package.json` with exact pins**

```json
{
  "name": "dubois-outloud",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check",
    "test": "vitest run",
    "fetch:text": "node scripts/fetch-text.mjs",
    "fetch:loc": "node scripts/fetch-loc.mjs",
    "fetch:audio": "node scripts/fetch-audio.mjs",
    "fetch:scans": "node scripts/crop-scans.mjs",
    "find:recordings": "node scripts/find-recordings.mjs",
    "assets": "pnpm fetch:audio && pnpm fetch:scans"
  },
  "dependencies": {
    "astro": "5.14.1",
    "sharp": "0.34.4",
    "yaml": "2.8.1",
    "zod": "3.25.76"
  },
  "devDependencies": {
    "@astrojs/check": "0.9.4",
    "typescript": "5.9.2",
    "vitest": "3.2.4"
  },
  "packageManager": "pnpm@10.18.0"
}
```

Note: if `pnpm install` reports any of these versions as unavailable, pin to the
nearest published version and record the substitution in the commit message. Do
not widen a pin to a range.

- [ ] **Step 5: Write `astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://dubois-outloud.fly.dev',
  // The spec requires zero client JS beyond one inline script. Astro ships
  // none by default; this keeps it that way if a component is ever added.
  build: { inlineStylesheets: 'always' },
});
```

- [ ] **Step 6: Write `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 7: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 8: Write `src/layouts/Base.astro`**

```astro
---
interface Props {
  title: string;
  description?: string;
}
const { title, description } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    {description && <meta name="description" content={description} />}
  </head>
  <body>
    <a href="#main" class="skip">Skip to content</a>
    <header><a href="/">The Souls of Black Folk</a></header>
    <main id="main"><slot /></main>
    <footer>
      <p>
        Text and notation from the 1903 edition, in the public domain.
        Recordings from the Library of Congress.
        <a href="/about/">Sources and rights</a>.
      </p>
    </footer>
    <style>
      :root { color-scheme: light dark; }
      .skip { position: absolute; left: -9999px; }
      .skip:focus { left: 0; }
      body {
        max-width: 42rem; margin: 0 auto; padding: 1rem;
        font: 1.125rem/1.6 Georgia, 'Times New Roman', serif;
      }
    </style>
  </body>
</html>
```

- [ ] **Step 9: Write a placeholder `src/pages/index.astro`**

```astro
---
import Base from '../layouts/Base.astro';
---
<Base title="The Souls of Black Folk">
  <h1>The Souls of Black Folk</h1>
  <p>W. E. B. Du Bois, 1903. With recordings from the Library of Congress.</p>
</Base>
```

- [ ] **Step 10: Append build artifacts to `.gitignore`**

The file already ignores `public/audio/`, `src/assets/notation/`, `dist/`,
`.astro/`, `node_modules/`, `.direnv/`, `.tmp/`. Confirm those lines are
present and add nothing else.

- [ ] **Step 11: Install and build**

Run:
```bash
nix develop --command pnpm install
nix develop --command pnpm build
```
Expected: `dist/index.html` exists and contains "The Souls of Black Folk".

- [ ] **Step 12: Commit**

```bash
git add flake.nix flake.lock .envrc package.json pnpm-lock.yaml \
        astro.config.mjs tsconfig.json vitest.config.ts \
        src/layouts/Base.astro src/pages/index.astro .gitignore
git commit -m "feat: nix dev shell and Astro skeleton that builds"
```

---

### Task 2: `songs.yaml`, the slug helper, and the songs schema

**Files:**
- Create: `src/data/songs.yaml`, `scripts/lib/slug.mjs`, `src/content.config.ts`, `tests/slug.test.ts`, `tests/songs-schema.test.ts`

**Interfaces:**
- Consumes: Task 1's Astro project.
- Produces:
  - `slugify(title: string): string` from `scripts/lib/slug.mjs` — lowercase, ASCII, hyphen-separated, no punctuation.
  - An Astro collection named `songs`, whose entries have the shape
    `{ slug: string, chapter: number, title: string, scan: { ia_item: string, page: number, crop: [number, number, number, number] } | null }`.
  - `songsSchema` exported from `src/content.config.ts` for direct unit testing.

- [ ] **Step 1: Write the failing slug test**

`tests/slug.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { slugify } from '../scripts/lib/slug.mjs';

describe('slugify', () => {
  it.each([
    ["Nobody Knows the Trouble I've Seen", 'nobody-knows-the-trouble-ive-seen'],
    ["Children, You'll Be Called On", 'children-youll-be-called-on'],
    ['My Lord, What a Mourning', 'my-lord-what-a-mourning'],
    ["I'm a Rolling", 'im-a-rolling'],
    ['A Great Camp-meeting in the Promised Land', 'a-great-camp-meeting-in-the-promised-land'],
    ['Weary Traveller', 'weary-traveller'],
    ['Do Bana Coba', 'do-bana-coba'],
  ])('slugifies %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('produces only lowercase letters, digits and hyphens', () => {
    const s = slugify("Nobody Knows the Trouble I've Seen");
    expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it('never produces a leading, trailing or doubled hyphen', () => {
    expect(slugify('  My Way\'s Cloudy!  ')).toBe('my-ways-cloudy');
    expect(slugify('The Rocks -- and the Mountains')).toBe('the-rocks-and-the-mountains');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `nix develop --command pnpm test -- slug`
Expected: FAIL, cannot resolve `../scripts/lib/slug.mjs`.

- [ ] **Step 3: Write `scripts/lib/slug.mjs`**

```js
/**
 * Title -> filename- and URL-safe slug.
 *
 * Song titles here carry apostrophes and commas ("Children, You'll Be Called
 * On"), and a slug becomes both a path segment and part of an MP3 filename.
 * Apostrophes are dropped rather than hyphenated, so "I've" reads as "ive"
 * instead of "i-ve".
 */
export function slugify(title) {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')  // strip combining accents
    .toLowerCase()
    .replace(/['’]/g, '')        // apostrophes vanish, not hyphenate
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 4: Run the slug tests**

Run: `nix develop --command pnpm test -- slug`
Expected: PASS, 9 assertions.

- [ ] **Step 5: Write `src/data/songs.yaml` with all 18 entries**

`scan` is `null` for every entry at this stage. Task 10 fills the page indices
and crop boxes by inspection, which needs the images in front of a human.

```yaml
# The spiritual Du Bois placed at each chapter head, from the 1903 edition.
# `scan` holds the page index and crop box within Internet Archive item
# cu31924024920492; Task 10 fills them in by inspection.
- slug: nobody-knows-the-trouble-ive-seen
  chapter: 1
  title: "Nobody Knows the Trouble I've Seen"
  scan: null
- slug: my-lord-what-a-mourning
  chapter: 2
  title: "My Lord, What a Mourning"
  scan: null
- slug: a-great-camp-meeting-in-the-promised-land
  chapter: 3
  title: "A Great Camp-meeting in the Promised Land"
  scan: null
- slug: my-ways-cloudy
  chapter: 4
  title: "My Way's Cloudy"
  scan: null
- slug: the-rocks-and-the-mountains
  chapter: 5
  title: "The Rocks and the Mountains"
  scan: null
- slug: march-on
  chapter: 6
  title: "March On"
  scan: null
- slug: bright-sparkles-in-the-churchyard
  chapter: 7
  title: "Bright Sparkles in the Churchyard"
  scan: null
- slug: children-youll-be-called-on
  chapter: 8
  title: "Children, You'll Be Called On"
  scan: null
- slug: im-a-rolling
  chapter: 9
  title: "I'm a Rolling"
  scan: null
- slug: steal-away
  chapter: 10
  title: "Steal Away"
  scan: null
- slug: i-hope-my-mother-will-be-there
  chapter: 11
  title: "I Hope My Mother Will Be There"
  scan: null
- slug: swing-low-sweet-chariot
  chapter: 12
  title: "Swing Low, Sweet Chariot"
  scan: null
- slug: ill-hear-the-trumpet-sound
  chapter: 13
  title: "I'll Hear the Trumpet Sound"
  scan: null
- slug: wrestlin-jacob
  chapter: 14
  title: "Wrestlin' Jacob"
  scan: null
- slug: do-bana-coba
  chapter: 14
  title: "Do Bana Coba"
  scan: null
- slug: my-soul-wants-something-thats-new
  chapter: 14
  title: "My Soul Wants Something That's New"
  scan: null
- slug: poor-rosy
  chapter: 14
  title: "Poor Rosy"
  scan: null
- slug: weary-traveller
  chapter: 14
  title: "Weary Traveller"
  scan: null
```

- [ ] **Step 6: Write the failing songs-schema test**

This is Review Focus item 1: every slug in the manifest must be what
`slugify` produces from its own title, so a path can never carry punctuation.

`tests/songs-schema.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { slugify } from '../scripts/lib/slug.mjs';
import { songsSchema } from '../src/content.config.ts';

const songs = parse(readFileSync('src/data/songs.yaml', 'utf8'));

describe('songs.yaml', () => {
  it('holds 18 songs', () => {
    expect(songs).toHaveLength(18);
  });

  it('validates against the schema', () => {
    for (const song of songs) {
      expect(() => songsSchema.parse(song)).not.toThrow();
    }
  });

  it('gives every song a slug that slugify would produce from its title', () => {
    for (const song of songs) {
      expect(song.slug).toBe(slugify(song.title));
    }
  });

  it('uses every slug exactly once', () => {
    const slugs = songs.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('covers chapters 1 through 14 with no gaps', () => {
    const chapters = new Set(songs.map((s) => s.chapter));
    expect([...chapters].sort((a, b) => a - b)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    );
  });

  it('gives chapter 14 five songs and every other chapter one', () => {
    const counts = new Map<number, number>();
    for (const s of songs) counts.set(s.chapter, (counts.get(s.chapter) ?? 0) + 1);
    expect(counts.get(14)).toBe(5);
    for (const ch of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      expect(counts.get(ch)).toBe(1);
    }
  });

  it('rejects a chapter outside 1..14', () => {
    expect(() => songsSchema.parse({ ...songs[0], chapter: 15 })).toThrow();
    expect(() => songsSchema.parse({ ...songs[0], chapter: 0 })).toThrow();
  });

  it('rejects a crop box that is not four numbers', () => {
    const bad = { ...songs[0], scan: { ia_item: 'x', page: 1, crop: [1, 2, 3] } };
    expect(() => songsSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 7: Run it to make sure it fails**

Run: `nix develop --command pnpm test -- songs-schema`
Expected: FAIL, `songsSchema` is not exported from `src/content.config.ts`.

- [ ] **Step 8: Write `src/content.config.ts` with the songs schema**

```ts
import { defineCollection, z } from 'astro:content';
import { file } from 'astro/loaders';

/**
 * Exported on its own so tests can validate src/data/songs.yaml directly,
 * without booting Astro.
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

const songs = defineCollection({
  loader: file('src/data/songs.yaml', { parser: (text) => text }),
  schema: songsSchema,
});

export const collections = { songs };
```

Note: Astro's `file()` loader needs each entry to carry an `id`. Set
`parser` to parse the YAML with the `yaml` package and map `slug` onto `id`:

```ts
import { parse } from 'yaml';
// …
  loader: file('src/data/songs.yaml', {
    parser: (text) => parse(text).map((s) => ({ ...s, id: s.slug })),
  }),
```

Use the second form. The first is shown only to explain why `id` appears.

- [ ] **Step 9: Run the tests and the build**

Run:
```bash
nix develop --command pnpm test
nix develop --command pnpm build
```
Expected: all tests PASS; build succeeds.

- [ ] **Step 10: Commit**

```bash
git add scripts/lib/slug.mjs src/data/songs.yaml src/content.config.ts \
        tests/slug.test.ts tests/songs-schema.test.ts
git commit -m "feat: songs manifest, slug helper and songs schema"
```

---

### Task 3: The recordings schema

**Files:**
- Create: `src/data/recordings.yaml`, `tests/recordings-schema.test.ts`
- Modify: `src/content.config.ts`

**Interfaces:**
- Consumes: `songsSchema` and the `songs` collection from Task 2.
- Produces:
  - `recordingSchema` exported from `src/content.config.ts`.
  - `validateManifest(recordings: unknown[], songSlugs: string[]): void` exported from `src/content.config.ts`, which throws an `Error` whose message names the offending `loc_id` and field.
  - An Astro collection named `recordings`.

- [ ] **Step 1: Seed `src/data/recordings.yaml` with the three known items**

These three are the items the user supplied and the spec verified. Their `loc:`
blocks are empty for now; Task 8 fills them.

```yaml
# The vetting file. You own `status`, `delivery` and `note`.
# Scripts own the `loc:` block and never touch anything above it.
#
#   status:   unreviewed | approved | rejected
#   delivery: selfhost | stream
#
- song: nobody-knows-the-trouble-ive-seen
  loc_id: jukebox-879940
  status: unreviewed
  delivery: null
  note: null
  loc: null
- song: my-lord-what-a-mourning
  loc_id: lomaxbib000533
  status: unreviewed
  delivery: null
  note: null
  loc: null
- song: swing-low-sweet-chariot
  loc_id: jukebox-128141
  status: unreviewed
  delivery: null
  note: null
  loc: null
```

- [ ] **Step 2: Write the failing schema test**

`tests/recordings-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { recordingSchema, validateManifest } from '../src/content.config.ts';

const SLUGS = ['steal-away', 'poor-rosy'];

const approved = {
  song: 'steal-away',
  loc_id: 'jukebox-4649',
  status: 'approved',
  delivery: 'selfhost',
  note: null,
  loc: {
    title: 'Steal away',
    date: '1902-10-29',
    collection: 'national jukebox',
    performers: ['Fisk University Jubilee Quartet'],
    place: null,
    duration_seconds: 150,
    audio_url: 'https://tile.loc.gov/x.mp3',
    can_download: true,
    rights: 'No known restrictions.',
    item_url: 'https://www.loc.gov/item/jukebox-4649/',
    checked: '2026-10-07',
  },
};

describe('recordingSchema', () => {
  it('accepts a fully vetted entry', () => {
    expect(() => recordingSchema.parse(approved)).not.toThrow();
  });

  it('accepts an unreviewed entry with no loc block', () => {
    const fresh = { song: 'poor-rosy', loc_id: 'x-1', status: 'unreviewed',
                    delivery: null, note: null, loc: null };
    expect(() => recordingSchema.parse(fresh)).not.toThrow();
  });

  it.each(['pending', 'APPROVED', '', 'ok'])('rejects status %s', (status) => {
    expect(() => recordingSchema.parse({ ...approved, status })).toThrow();
  });

  it.each(['host', 'download', 'embed'])('rejects delivery %s', (delivery) => {
    expect(() => recordingSchema.parse({ ...approved, delivery })).toThrow();
  });
});

describe('validateManifest', () => {
  it('passes a clean manifest', () => {
    expect(() => validateManifest([approved], SLUGS)).not.toThrow();
  });

  it('rejects a song slug that is not in songs.yaml', () => {
    const orphan = { ...approved, song: 'no-such-song' };
    expect(() => validateManifest([orphan], SLUGS)).toThrow(/no-such-song/);
  });

  it('names the loc_id when it rejects an entry', () => {
    const orphan = { ...approved, song: 'no-such-song' };
    expect(() => validateManifest([orphan], SLUGS)).toThrow(/jukebox-4649/);
  });

  it('rejects an approved entry with no audio_url', () => {
    const dead = { ...approved, loc: { ...approved.loc, audio_url: null } };
    expect(() => validateManifest([dead], SLUGS)).toThrow(/audio_url/);
  });

  it('rejects an approved entry with no loc block at all', () => {
    const bare = { ...approved, loc: null };
    expect(() => validateManifest([bare], SLUGS)).toThrow(/jukebox-4649/);
  });

  it('rejects selfhost when can_download is false', () => {
    const nope = { ...approved, loc: { ...approved.loc, can_download: false } };
    expect(() => validateManifest([nope], SLUGS)).toThrow(/can_download/);
  });

  it('allows a rejected entry to be incomplete', () => {
    const rej = { song: 'poor-rosy', loc_id: 'x-2', status: 'rejected',
                  delivery: null, note: 'Piano only, no voices.', loc: null };
    expect(() => validateManifest([rej], SLUGS)).not.toThrow();
  });

  it('allows an approved stream entry with can_download false', () => {
    const streamed = {
      ...approved,
      delivery: 'stream',
      loc: { ...approved.loc, can_download: false },
    };
    expect(() => validateManifest([streamed], SLUGS)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `nix develop --command pnpm test -- recordings-schema`
Expected: FAIL, `recordingSchema` is not exported.

- [ ] **Step 4: Add the schema and `validateManifest` to `src/content.config.ts`**

```ts
export const locSchema = z.object({
  title: z.string().min(1),
  date: z.string().nullable(),
  collection: z.string().nullable(),
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

/**
 * Cross-entry rules Zod cannot express on its own. Every message names the
 * loc_id, because the person reading a failed build needs to find the line.
 *
 * The spec is deliberate that an approved recording with a dead audio_url
 * fails the build: a silent gap in a lesson is worse than a failed deploy.
 */
export function validateManifest(recordings, songSlugs) {
  const slugs = new Set(songSlugs);
  const seen = new Map();

  for (const r of recordings) {
    const where = `recordings.yaml entry ${r.loc_id}`;
    recordingSchema.parse(r);

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
```

Register the collection alongside `songs`.

**This wiring is load-bearing.** Astro's `schema` validates each entry on its
own, so it can never catch an orphan slug, a duplicate `loc_id`, or an approved
entry with a dead `audio_url` — those are cross-entry rules. `validateManifest`
must therefore run inside the loader's `parser`, which is the one place at build
time that sees the whole array. Without this call the function is dead code and
the spec's central promise does not hold.

```ts
import { readFileSync } from 'node:fs';

const recordings = defineCollection({
  loader: file('src/data/recordings.yaml', {
    parser: (text) => {
      const entries = parse(text) ?? [];

      // The cross-entry gate. Reading songs.yaml here rather than importing the
      // songs collection keeps the parser synchronous, which `file()` requires.
      const songSlugs = (parse(readFileSync('src/data/songs.yaml', 'utf8')) ?? [])
        .map((s) => s.slug);
      validateManifest(entries, songSlugs);

      const unreviewed = entries.filter((e) => e.status === 'unreviewed').length;
      if (unreviewed > 0) {
        console.log(
          `[recordings] ${unreviewed} entries are still status: unreviewed. ` +
            `They are excluded from the site until you approve them.`,
        );
      }

      return entries.map((r, i) => ({ ...r, id: `${r.loc_id}-${i}` }));
    },
  }),
  schema: recordingSchema,
});

export const collections = { songs, recordings };
```

- [ ] **Step 5: Run the tests**

Run: `nix develop --command pnpm test -- recordings-schema`
Expected: PASS, 16 assertions.

- [ ] **Step 6: Add the duplicate-`loc_id` test**

This is Review Focus item 3, first half. Append to
`tests/recordings-schema.test.ts`:

```ts
describe('validateManifest duplicate detection', () => {
  it('rejects two entries sharing a loc_id', () => {
    const a = { ...approved };
    const b = { ...approved, song: 'poor-rosy' };
    expect(() => validateManifest([a, b], SLUGS)).toThrow(/duplicate loc_id/);
  });

  it('names both songs when it reports a duplicate', () => {
    const a = { ...approved };
    const b = { ...approved, song: 'poor-rosy' };
    expect(() => validateManifest([a, b], SLUGS)).toThrow(/steal-away/);
  });

  it('allows the same song to have several different recordings', () => {
    const a = { ...approved };
    const b = { ...approved, loc_id: 'jukebox-9999' };
    expect(() => validateManifest([a, b], SLUGS)).not.toThrow();
  });
});
```

- [ ] **Step 7: Run the tests and the build**

Run:
```bash
nix develop --command pnpm test
nix develop --command pnpm build
```
Expected: all PASS. The build succeeds, because all three seeded entries are
`unreviewed` and therefore exempt from the approved-entry rules. The build
prints `[recordings] 3 entries are still status: unreviewed`.

- [ ] **Step 8: Prove the cross-entry gate fires during a real build**

A unit test passing does not prove the function is wired in. Break the manifest
and confirm the build refuses it.

```bash
# Point an entry at a song that does not exist.
sed -i '0,/^- song:/{s/^- song: .*/- song: no-such-song/}' src/data/recordings.yaml
nix develop --command pnpm build; echo "exit=$?"
git checkout src/data/recordings.yaml
```

Expected: the build fails, `exit=1`, and the error message contains both
`no-such-song` and the entry's `loc_id`.

If the build instead SUCCEEDS, `validateManifest` is not being called. Do not
continue — the spec's central promise depends on this call. Re-check the
`parser` in Step 4.

- [ ] **Step 9: Commit**

```bash
git add src/data/recordings.yaml src/content.config.ts tests/recordings-schema.test.ts
git commit -m "feat: recordings schema with cross-entry validation"
```

---

### Task 4: The Gutenberg text splitter

**Files:**
- Create: `scripts/lib/http.mjs`, `scripts/fetch-text.mjs`, `tests/fixtures/gutenberg/pg408-sample.txt`, `tests/split-text.test.ts`
- Modify: none

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `fetchText(url: string): Promise<string>` and `sleep(ms: number): Promise<void>` from `scripts/lib/http.mjs`.
  - `splitBook(raw: string): { id: string, heading: string, body: string }[]` exported from `scripts/fetch-text.mjs`, returning 16 sections: `00` (Forethought), `01`–`14`, and `15` (Afterthought).

- [ ] **Step 1: Write `scripts/lib/http.mjs`**

```js
const UA =
  'dubois-outloud/1.0 (+https://github.com/OWNER/dubois-outloud; zach.thomas@hey.com)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Serial, polite, retrying fetch. Every caller in this project shares it so
 * that no code path can accidentally hammer loc.gov or archive.org in
 * parallel. Replace OWNER above once the repository exists.
 */
async function request(url, init = {}, attempt = 1) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
  });
  if (res.ok) return res;
  const retryable = res.status === 429 || res.status >= 500;
  if (retryable && attempt < 3) {
    await sleep(500 * 2 ** attempt);
    return request(url, init, attempt + 1);
  }
  throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
}

export async function fetchText(url) {
  const res = await request(url);
  await sleep(250);
  return res.text();
}

export async function fetchJson(url) {
  const res = await request(url);
  await sleep(250);
  return res.json();
}

export async function fetchBinary(url) {
  const res = await request(url);
  await sleep(250);
  const buf = Buffer.from(await res.arrayBuffer());
  const declared = res.headers.get('content-length');
  return { buf, declared: declared === null ? null : Number(declared) };
}
```

- [ ] **Step 2: Save the Gutenberg fixture**

Run:
```bash
mkdir -p tests/fixtures/gutenberg
nix develop --command node -e "
  const u='https://www.gutenberg.org/cache/epub/408/pg408.txt';
  const fs=require('node:fs');
  fetch(u).then(r=>r.text()).then(t=>{
    fs.writeFileSync('tests/fixtures/gutenberg/pg408-sample.txt', t);
    console.log('bytes', t.length);
  });
"
```
Expected: roughly 428,000 bytes. The whole file is the fixture; it is public
domain, so committing it is both legal and the most faithful test input.

- [ ] **Step 3: Write the failing splitter test**

The hazard this pins: each roman-numeral chapter head appears **twice** in the
file, once in the table of contents near line 37 and once as the real head
near line 109. A naive split produces 28 sections, 14 of them empty.

`tests/split-text.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitBook } from '../scripts/fetch-text.mjs';

const raw = readFileSync('tests/fixtures/gutenberg/pg408-sample.txt', 'utf8');
const sections = splitBook(raw);

describe('splitBook', () => {
  it('returns 16 sections', () => {
    expect(sections).toHaveLength(16);
  });

  it('ids them 00 through 15 in order', () => {
    expect(sections.map((s) => s.id)).toEqual([
      '00', '01', '02', '03', '04', '05', '06', '07',
      '08', '09', '10', '11', '12', '13', '14', '15',
    ]);
  });

  it('does not mistake the table of contents for chapter heads', () => {
    // 14 numerals x 2 occurrences = 28 candidate heads in the raw file.
    const candidates = raw.match(/^\s*(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV)\.\s/gm);
    expect(candidates!.length).toBe(28);
    // Every section must have real prose in it, not an empty TOC stub.
    for (const s of sections) {
      expect(s.body.length).toBeGreaterThan(400);
    }
  });

  it('strips the Project Gutenberg header and licence footer', () => {
    const all = sections.map((s) => s.body).join('\n');
    expect(all).not.toMatch(/PROJECT GUTENBERG/i);
    expect(all).not.toMatch(/START OF THE PROJECT/i);
    expect(all).not.toMatch(/END OF THE PROJECT/i);
  });

  it('gives chapter 1 the heading Du Bois gave it', () => {
    expect(sections[1].heading).toBe('Of Our Spiritual Strivings');
  });

  it('gives chapter 14 the sorrow songs heading', () => {
    expect(sections[14].heading).toBe('Of the Sorrow Songs');
  });

  it('orders the sections so each body is longer than a stub', () => {
    const forethought = sections[0];
    expect(forethought.heading).toMatch(/Forethought/i);
    expect(sections[15].heading).toMatch(/Afterthought/i);
  });

  it('throws when a numeral does not appear exactly twice', () => {
    const mangled = raw.replace(/^X\.\s+Of the Faith of the Fathers$/m, 'X. Of the Faith');
    // Still two occurrences, so this must not throw.
    expect(() => splitBook(mangled)).not.toThrow();

    const truncated = raw.slice(0, raw.indexOf('XIV.'));
    expect(() => splitBook(truncated)).toThrow(/XIV/);
  });
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `nix develop --command pnpm test -- split-text`
Expected: FAIL, `splitBook` is not exported from `scripts/fetch-text.mjs`.

- [ ] **Step 5: Write `scripts/fetch-text.mjs`**

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchText } from './lib/http.mjs';

const SOURCE = 'https://www.gutenberg.org/cache/epub/408/pg408.txt';
const OUT_DIR = 'src/content/chapters';

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII',
                  'IX', 'X', 'XI', 'XII', 'XIII', 'XIV'];

/**
 * Split the Gutenberg plain text into 16 sections.
 *
 * The one real hazard: every roman-numeral chapter head appears twice, once
 * in the table of contents and once as the actual head. We therefore take the
 * LAST occurrence of each numeral and assert there are exactly two. Asserting
 * the count means a reformatted Gutenberg file fails loudly rather than
 * silently producing stub chapters.
 */
export function splitBook(raw) {
  const startMarker = /^\*\*\* START OF THE PROJECT GUTENBERG EBOOK.*$/m;
  const endMarker = /^\*\*\* END OF THE PROJECT GUTENBERG EBOOK.*$/m;

  const startAt = raw.search(startMarker);
  const endAt = raw.search(endMarker);
  if (startAt < 0) throw new Error('Gutenberg START marker not found');
  if (endAt < 0) throw new Error('Gutenberg END marker not found');

  const body = raw
    .slice(raw.indexOf('\n', startAt) + 1, endAt)
    .replace(/\r\n/g, '\n');

  // Locate the real head of each chapter.
  const heads = [];
  for (const numeral of NUMERALS) {
    const re = new RegExp(`^${numeral}\\.[ \\t]+(.+)$`, 'gm');
    const hits = [...body.matchAll(re)];
    if (hits.length !== 2) {
      throw new Error(
        `Expected numeral ${numeral}. to appear exactly twice ` +
          `(table of contents, then the chapter head) but found ${hits.length}. ` +
          `The Gutenberg file at ${SOURCE} may have been reformatted.`,
      );
    }
    const real = hits[1];
    heads.push({ numeral, heading: real[1].trim(), at: real.index });
  }

  const foreAt = body.search(/^\s*THE FORETHOUGHT\s*$/m);
  const afterAt = body.search(/^\s*THE AFTERTHOUGHT\s*$/m);
  if (foreAt < 0) throw new Error('THE FORETHOUGHT heading not found');
  if (afterAt < 0) throw new Error('THE AFTERTHOUGHT heading not found');

  const marks = [
    { id: '00', heading: 'The Forethought', at: foreAt },
    ...heads.map((h, i) => ({
      id: String(i + 1).padStart(2, '0'),
      heading: h.heading,
      at: h.at,
    })),
    { id: '15', heading: 'The Afterthought', at: afterAt },
  ].sort((a, b) => a.at - b.at);

  return marks.map((m, i) => {
    const stop = i + 1 < marks.length ? marks[i + 1].at : body.length;
    const slice = body.slice(m.at, stop);
    // Drop the heading line itself; it is carried in `heading`.
    const text = slice.slice(slice.indexOf('\n') + 1).trim();
    return { id: m.id, heading: m.heading, body: text };
  });
}

function toMarkdown({ id, heading, body }) {
  const chapter = id === '00' || id === '15' ? 'null' : String(Number(id));
  return [
    '---',
    `heading: ${JSON.stringify(heading)}`,
    `chapter: ${chapter}`,
    'source: "Project Gutenberg eBook 408, the 1903 edition, public domain"',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

async function main() {
  const raw = await fetchText(SOURCE);
  const sections = splitBook(raw);
  mkdirSync(OUT_DIR, { recursive: true });
  for (const section of sections) {
    writeFileSync(`${OUT_DIR}/${section.id}.md`, toMarkdown(section));
  }
  console.log(`Wrote ${sections.length} sections to ${OUT_DIR}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
```

- [ ] **Step 6: Run the splitter tests**

Run: `nix develop --command pnpm test -- split-text`
Expected: PASS.

If the heading assertions fail, read the actual headings out of the fixture and
correct the expected strings in the test. Do not loosen the assertion to a
regex that would pass on a stub.

- [ ] **Step 7: Run the script for real**

Run: `nix develop --command pnpm fetch:text`
Expected: `Wrote 16 sections to src/content/chapters`, and
`src/content/chapters/01.md` through `15.md` plus `00.md` exist.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/http.mjs scripts/fetch-text.mjs \
        tests/fixtures/gutenberg/pg408-sample.txt tests/split-text.test.ts \
        src/content/chapters
git commit -m "feat: split the Gutenberg text into 16 chapter files"
```

---

### Task 5: Chapter pages render the text

**Files:**
- Create: `src/pages/chapter/[n].astro`, `src/pages/afterthought.astro`
- Modify: `src/content.config.ts`, `src/pages/index.astro`

**Interfaces:**
- Consumes: the chapter Markdown from Task 4, the `songs` collection from Task 2.
- Produces: routes `/chapter/1/` … `/chapter/14/`, `/afterthought/`, and a `/` that lists chapters. Each chapter page exposes an `<h1>` holding the chapter heading and an `<article>` holding the prose.

- [ ] **Step 1: Add the chapters collection to `src/content.config.ts`**

```ts
import { glob } from 'astro/loaders';

const chapters = defineCollection({
  loader: glob({ pattern: '*.md', base: 'src/content/chapters' }),
  schema: z.object({
    heading: z.string().min(1),
    chapter: z.number().int().min(1).max(14).nullable(),
    source: z.string(),
  }),
});

export const collections = { songs, recordings, chapters };
```

- [ ] **Step 2: Write `src/pages/chapter/[n].astro`**

```astro
---
import { getCollection, render } from 'astro:content';
import Base from '../../layouts/Base.astro';

export async function getStaticPaths() {
  const chapters = await getCollection('chapters', (c) => c.data.chapter !== null);
  return chapters.map((entry) => ({
    params: { n: String(entry.data.chapter) },
    props: { entry },
  }));
}

const { entry } = Astro.props;
const { Content } = await render(entry);
const n = entry.data.chapter!;
---
<Base title={`${n}. ${entry.data.heading} — The Souls of Black Folk`}>
  <p class="eyebrow">Chapter {n}</p>
  <h1>{entry.data.heading}</h1>
  <article><Content /></article>
  <nav class="chapter-nav">
    {n > 1 && <a href={`/chapter/${n - 1}/`} rel="prev">Previous chapter</a>}
    {n < 14 && <a href={`/chapter/${n + 1}/`} rel="next">Next chapter</a>}
    {n === 14 && <a href="/afterthought/" rel="next">The Afterthought</a>}
  </nav>
  <style>
    .eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: .8rem; }
    .chapter-nav { display: flex; justify-content: space-between; margin-top: 3rem; }
  </style>
</Base>
```

- [ ] **Step 3: Write `src/pages/afterthought.astro`**

```astro
---
import { getEntry, render } from 'astro:content';
import Base from '../layouts/Base.astro';

const entry = await getEntry('chapters', '15');
if (!entry) throw new Error('src/content/chapters/15.md is missing; run pnpm fetch:text');
const { Content } = await render(entry);
---
<Base title="The Afterthought — The Souls of Black Folk">
  <h1>{entry.data.heading}</h1>
  <article><Content /></article>
</Base>
```

- [ ] **Step 4: Rewrite `src/pages/index.astro` to list the chapters**

```astro
---
import { getCollection, getEntry, render } from 'astro:content';
import Base from '../layouts/Base.astro';

const chapters = (await getCollection('chapters', (c) => c.data.chapter !== null))
  .sort((a, b) => a.data.chapter! - b.data.chapter!);

const songs = await getCollection('songs');
const songsFor = (n: number) =>
  songs.filter((s) => s.data.chapter === n).map((s) => s.data.title);

const forethought = await getEntry('chapters', '00');
if (!forethought) throw new Error('src/content/chapters/00.md is missing; run pnpm fetch:text');
const { Content: Forethought } = await render(forethought);
---
<Base
  title="The Souls of Black Folk"
  description="W. E. B. Du Bois, 1903, with recordings of the sorrow songs from the Library of Congress."
>
  <h1>The Souls of Black Folk</h1>
  <p class="byline">W. E. B. Du Bois, 1903</p>
  <article><Forethought /></article>

  <h2>Chapters</h2>
  <ol class="chapters">
    {chapters.map((c) => (
      <li>
        <a href={`/chapter/${c.data.chapter}/`}>{c.data.heading}</a>
        <span class="songs">{songsFor(c.data.chapter!).join(' · ')}</span>
      </li>
    ))}
    <li><a href="/afterthought/">The Afterthought</a></li>
  </ol>

  <p><a href="/songs/">Table of the songs</a> · <a href="/about/">Sources and rights</a></p>

  <style>
    .byline { font-style: italic; }
    .chapters li { margin-bottom: .75rem; }
    .songs { display: block; font-size: .9rem; font-style: italic; opacity: .8; }
  </style>
</Base>
```

Note: `/songs/` and `/about/` do not exist until Task 12. The link check in
Task 14 runs after both exist, so this is not a broken-link window that CI sees.

- [ ] **Step 5: Build and check the output**

Run:
```bash
nix develop --command pnpm build
ls dist/chapter/
grep -c 'Of Our Spiritual Strivings' dist/chapter/1/index.html
```
Expected: directories `1` through `14` exist; the grep returns at least 1.

- [ ] **Step 6: Run the typecheck**

Run: `nix develop --command pnpm check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/content.config.ts src/pages/
git commit -m "feat: chapter pages, afterthought and a chapter index"
```

---

### Task 6: Parse loc.gov JSON into recording metadata

**Files:**
- Create: `scripts/lib/loc-parse.mjs`, `tests/fixtures/loc/jukebox-879940.json`, `tests/fixtures/loc/jukebox-128141.json`, `tests/fixtures/loc/lomaxbib000533.json`, `tests/fixtures/loc/no-audio.json`, `tests/loc-parse.test.ts`

**Interfaces:**
- Consumes: `fetchJson` from Task 4's `scripts/lib/http.mjs`.
- Produces:
  - `parseItem(json: object, locId: string): { title, date, collection, performers, place, duration_seconds, audio_url, can_download, rights, item_url } | null` from `scripts/lib/loc-parse.mjs`. Returns `null` when the item exposes no audio resource.
  - `stripHtml(s: string): string` from the same module.

- [ ] **Step 1: Save the four fixtures**

Run:
```bash
mkdir -p tests/fixtures/loc
for id in jukebox-879940 jukebox-128141 lomaxbib000533; do
  nix develop --command node -e "
    const fs=require('node:fs');
    fetch('https://www.loc.gov/item/$id/?fo=json', {
      headers: {'User-Agent':'dubois-outloud/1.0 (zach.thomas@hey.com)'}
    }).then(r=>r.json()).then(j=>{
      fs.writeFileSync('tests/fixtures/loc/$id.json', JSON.stringify(j,null,2));
      console.log('$id ok');
    });
  "
  sleep 1
done
```
Expected: three files, each tens of kilobytes.

Then hand-write `tests/fixtures/loc/no-audio.json` — an item with image
resources only, which is Review Focus item 4:

```json
{
  "item": {
    "title": "Sheet music, no recording",
    "date": "1899",
    "rights": ["<p>No known restrictions on publication.</p>"],
    "online_format": ["image"],
    "partof": ["notated music"]
  },
  "resources": [
    {
      "image": "https://tile.loc.gov/image-services/x/default.jpg",
      "files": [[{ "mimetype": "image/jpeg", "url": "https://tile.loc.gov/x.jpg" }]],
      "url": "https://www.loc.gov/item/no-audio/"
    }
  ]
}
```

- [ ] **Step 2: Write the failing parser test**

`tests/loc-parse.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseItem, stripHtml } from '../scripts/lib/loc-parse.mjs';

const load = (id: string) =>
  JSON.parse(readFileSync(`tests/fixtures/loc/${id}.json`, 'utf8'));

describe('parseItem', () => {
  it('reads the 1917 Jukebox spiritual', () => {
    const r = parseItem(load('jukebox-879940'), 'jukebox-879940')!;
    expect(r.title).toBe("Nobody knows de trouble I've seen");
    expect(r.date).toBe('1917-11-21');
    expect(r.duration_seconds).toBe(186);
    expect(r.audio_url).toMatch(/^https:\/\/tile\.loc\.gov\/.*\.mp3$/);
    expect(r.can_download).toBe(true);
    expect(r.collection).toMatch(/jukebox/i);
    expect(r.item_url).toBe('https://www.loc.gov/item/jukebox-879940/');
  });

  it('reads the 1909 Jukebox Swing Low', () => {
    const r = parseItem(load('jukebox-128141'), 'jukebox-128141')!;
    expect(r.title).toBe('Swing low, sweet chariot');
    expect(r.date).toBe('1909-12-01');
    expect(r.duration_seconds).toBe(180);
    expect(r.collection).toMatch(/jukebox/i);
  });

  it('reads the 1939 Lomax field recording', () => {
    const r = parseItem(load('lomaxbib000533'), 'lomaxbib000533')!;
    expect(r.title).toBe("My Lord, What a Mornin'");
    expect(r.date).toBe('1939-06-11');
    expect(r.audio_url).toMatch(/\.mp3$/);
    expect(r.rights).toMatch(/not aware of any U\.S\. copyright/i);
  });

  it('prefers a downloadable resource over a restricted one', () => {
    // The Lomax item exposes one resource with canDownload false and another
    // with canDownload true. We must land on the true one.
    const r = parseItem(load('lomaxbib000533'), 'lomaxbib000533')!;
    expect(r.can_download).toBe(true);
  });

  it('always returns an array of performers', () => {
    for (const id of ['jukebox-879940', 'jukebox-128141', 'lomaxbib000533']) {
      const r = parseItem(load(id), id)!;
      expect(Array.isArray(r.performers)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `nix develop --command pnpm test -- loc-parse`
Expected: FAIL, `parseItem` is not exported.

- [ ] **Step 4: Write `scripts/lib/loc-parse.mjs`**

```js
/**
 * The loc.gov `rights` field is an array of HTML strings, for example
 * ['<p>The Library makes the sound recordings…</p>']. It goes into YAML and
 * then onto a page, so the markup comes out here, once, at the boundary.
 */
export function stripHtml(s) {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

function audioResources(json) {
  return (json.resources ?? []).filter((r) => typeof r.audio === 'string' && r.audio);
}

/**
 * Pick the audio resource we should use.
 *
 * An item can expose the same recording twice, once as an ingested API copy
 * marked canDownload: false and once as the collection copy marked true. We
 * prefer a downloadable resource so that `delivery: selfhost` stays honest.
 */
function pickResource(resources) {
  const downloadable = resources.find((r) =>
    (r.files ?? []).flat().some((f) => f && f.canDownload === true),
  );
  return downloadable ?? resources[0];
}

function canDownload(resource) {
  return (resource.files ?? []).flat().some((f) => f && f.canDownload === true);
}

function performersOf(item) {
  const out = new Set();
  for (const key of ['contributor_vocalist', 'contributor_primary', 'contributor']) {
    const v = item[key];
    if (Array.isArray(v)) for (const name of v) out.add(stripHtml(name));
    else if (typeof v === 'string') out.add(stripHtml(v));
    else if (v && typeof v === 'object') for (const name of Object.keys(v)) out.add(stripHtml(name));
  }
  return [...out].filter(Boolean);
}

function durationOf(resource) {
  for (const f of (resource.files ?? []).flat()) {
    if (f && typeof f.duration === 'number') return f.duration;
  }
  return null;
}

/**
 * loc.gov item JSON -> the `loc:` block we store in recordings.yaml.
 * Returns null when the item exposes no audio at all, which happens when an
 * item is withdrawn or holds only images.
 */
export function parseItem(json, locId) {
  const item = json.item ?? {};
  const resources = audioResources(json);
  if (resources.length === 0) return null;

  const resource = pickResource(resources);

  return {
    title: stripHtml(first(item.title) ?? locId),
    date: item.date ? String(item.date) : null,
    collection: first(item.partof) ? stripHtml(first(item.partof)) : null,
    performers: performersOf(item),
    place: first(item.location) ? stripHtml(first(item.location)) : null,
    duration_seconds: durationOf(resource),
    audio_url: resource.audio,
    can_download: canDownload(resource),
    rights: stripHtml((Array.isArray(item.rights) ? item.rights : [item.rights ?? '']).join(' ')),
    item_url: `https://www.loc.gov/item/${locId}/`,
  };
}
```

- [ ] **Step 5: Run the parser tests**

Run: `nix develop --command pnpm test -- loc-parse`
Expected: PASS.

If a title or performer assertion fails, read the real value out of the fixture
and correct the test. The fixtures are ground truth.

- [ ] **Step 6: Add the no-audio test**

This is Review Focus item 4. Append to `tests/loc-parse.test.ts`:

```ts
describe('parseItem with no audio', () => {
  it('returns null for an item that exposes only images', () => {
    expect(parseItem(load('no-audio'), 'no-audio')).toBeNull();
  });

  it('returns null for an item with no resources key at all', () => {
    expect(parseItem({ item: { title: 'Gone' } }, 'gone')).toBeNull();
  });

  it('returns null for an empty resources array', () => {
    expect(parseItem({ item: { title: 'Gone' }, resources: [] }, 'gone')).toBeNull();
  });

  it('never returns the string "undefined" as an audio_url', () => {
    const odd = { item: { title: 'Odd' }, resources: [{ audio: '' }] };
    expect(parseItem(odd, 'odd')).toBeNull();
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `nix develop --command pnpm test -- loc-parse`
Expected: PASS.

- [ ] **Step 8: Add the HTML-in-rights test**

This is Review Focus item 2. Append to `tests/loc-parse.test.ts`:

```ts
describe('stripHtml', () => {
  it('removes the markup loc.gov wraps rights statements in', () => {
    expect(stripHtml('<p>No known restrictions.</p>')).toBe('No known restrictions.');
  });

  it('decodes the entities that appear in loc.gov metadata', () => {
    expect(stripHtml('Sony &amp; EMI')).toBe('Sony & EMI');
    expect(stripHtml('Fisk&rsquo;s quartet')).toBe("Fisk's quartet");
  });

  it('collapses the whitespace that removing tags leaves behind', () => {
    expect(stripHtml('<p>One</p>\n<p>Two</p>')).toBe('One Two');
  });

  it('leaves no angle bracket behind that could open a tag', () => {
    expect(stripHtml('<script>alert(1)</script>ok')).not.toMatch(/[<>]/);
  });

  it('yields a rights string with no markup for every real fixture', () => {
    for (const id of ['jukebox-879940', 'jukebox-128141', 'lomaxbib000533']) {
      const r = parseItem(load(id), id)!;
      expect(r.rights).not.toMatch(/[<>]/);
      expect(r.rights.length).toBeGreaterThan(20);
    }
  });
});
```

- [ ] **Step 9: Run the tests**

Run: `nix develop --command pnpm test`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/lib/loc-parse.mjs tests/fixtures/loc/ tests/loc-parse.test.ts
git commit -m "feat: parse loc.gov item JSON into recording metadata"
```

---

### Task 7: The delivery rights rule

**Files:**
- Create: `scripts/lib/rights.mjs`, `tests/rights.test.ts`

**Interfaces:**
- Consumes: the metadata object `parseItem` returns, from Task 6.
- Produces: `proposeDelivery(loc: { collection, date, can_download, rights }): 'selfhost' | 'stream'` from `scripts/lib/rights.mjs`.

- [ ] **Step 1: Write the failing rights test**

`tests/rights.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { proposeDelivery } from '../scripts/lib/rights.mjs';

const NO_RESTRICTIONS =
  'The Library of Congress is not aware of any U.S. copyright protection ' +
  '(see Title 17, U.S.C.) or any other restrictions in the material in this collection.';
const JUKEBOX =
  'The Library makes the sound recordings in the National Jukebox available ' +
  'pursuant to permission from the rightsholders. Under the Music Modernization Act, ' +
  'many of these recordings will begin entering the public domain.';

describe('proposeDelivery', () => {
  it('self-hosts a no-known-restrictions field recording', () => {
    expect(proposeDelivery({
      collection: 'lomax collection', date: '1939-06-11',
      can_download: true, rights: NO_RESTRICTIONS,
    })).toBe('selfhost');
  });

  it('self-hosts a pre-1923 Jukebox side on Music Modernization Act grounds', () => {
    expect(proposeDelivery({
      collection: 'national jukebox', date: '1909-12-01',
      can_download: true, rights: JUKEBOX,
    })).toBe('selfhost');
    expect(proposeDelivery({
      collection: 'national jukebox', date: '1917-11-21',
      can_download: true, rights: JUKEBOX,
    })).toBe('selfhost');
  });

  it('streams a 1923-or-later Jukebox side', () => {
    expect(proposeDelivery({
      collection: 'national jukebox', date: '1923-01-02',
      can_download: true, rights: JUKEBOX,
    })).toBe('stream');
    expect(proposeDelivery({
      collection: 'national jukebox', date: '1935-04-01',
      can_download: true, rights: JUKEBOX,
    })).toBe('stream');
  });

  it('streams anything that cannot be downloaded, whatever the rights say', () => {
    expect(proposeDelivery({
      collection: 'lomax collection', date: '1939-06-11',
      can_download: false, rights: NO_RESTRICTIONS,
    })).toBe('stream');
  });

  it('streams when the date is missing, because the 1923 test cannot run', () => {
    expect(proposeDelivery({
      collection: 'national jukebox', date: null,
      can_download: true, rights: JUKEBOX,
    })).toBe('stream');
  });

  it('streams when the rights statement is empty', () => {
    expect(proposeDelivery({
      collection: 'something', date: '1910', can_download: true, rights: '',
    })).toBe('stream');
  });

  it('reads a bare year as a date', () => {
    expect(proposeDelivery({
      collection: 'national jukebox', date: '1912',
      can_download: true, rights: JUKEBOX,
    })).toBe('selfhost');
  });

  it('treats 1922 as inside the public domain and 1923 as outside', () => {
    const at = (date: string) => proposeDelivery({
      collection: 'national jukebox', date, can_download: true, rights: JUKEBOX,
    });
    expect(at('1922-12-31')).toBe('selfhost');
    expect(at('1923-01-01')).toBe('stream');
  });

  it('defaults an unrecognised collection with no clear rights to stream', () => {
    expect(proposeDelivery({
      collection: 'some other collection', date: '1950',
      can_download: true, rights: 'Rights status unevaluated.',
    })).toBe('stream');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `nix develop --command pnpm test -- rights`
Expected: FAIL, `proposeDelivery` is not exported.

- [ ] **Step 3: Write `scripts/lib/rights.mjs`**

```js
/**
 * Propose a delivery mode from an item's rights statement and date.
 *
 * This is the engineering rule from the design, section 3.1. It is not legal
 * advice, and it only ever proposes: fetch-loc.mjs writes the value when the
 * field is absent and never overwrites a human's choice.
 *
 * The 1923 boundary comes from the Music Modernization Act, which moved
 * pre-1923 sound recordings into the public domain. The Library's own National
 * Jukebox rights statement raises the Act, so a pre-1923 Jukebox side has a
 * defensible public-domain argument even though the Library hosts the
 * collection by permission from Sony and EMI.
 */

const PUBLIC_DOMAIN_BEFORE = 1923;

const NO_KNOWN_RESTRICTIONS =
  /not aware of any (?:U\.S\.\s*)?copyright|no known restrictions/i;

const JUKEBOX = /national jukebox/i;

function yearOf(date) {
  if (!date) return null;
  const m = String(date).match(/\b(1[89]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

export function proposeDelivery(loc) {
  // A resource we cannot download cannot be self-hosted, whatever its rights.
  if (!loc.can_download) return 'stream';

  const rights = loc.rights ?? '';
  if (NO_KNOWN_RESTRICTIONS.test(rights)) return 'selfhost';

  const inJukebox = JUKEBOX.test(loc.collection ?? '') || JUKEBOX.test(rights);
  if (inJukebox) {
    const year = yearOf(loc.date);
    // No date means the boundary test cannot run, so we take the cautious side.
    if (year !== null && year < PUBLIC_DOMAIN_BEFORE) return 'selfhost';
    return 'stream';
  }

  return 'stream';
}
```

- [ ] **Step 4: Run the tests**

Run: `nix develop --command pnpm test -- rights`
Expected: PASS, 14 assertions.

- [ ] **Step 5: Add a test tying the rule to the real fixtures**

Append to `tests/rights.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { parseItem } from '../scripts/lib/loc-parse.mjs';

describe('proposeDelivery against real loc.gov items', () => {
  const load = (id: string) =>
    parseItem(JSON.parse(readFileSync(`tests/fixtures/loc/${id}.json`, 'utf8')), id)!;

  it('self-hosts the 1917 Jukebox side', () => {
    expect(proposeDelivery(load('jukebox-879940'))).toBe('selfhost');
  });

  it('self-hosts the 1909 Jukebox side', () => {
    expect(proposeDelivery(load('jukebox-128141'))).toBe('selfhost');
  });

  it('self-hosts the 1939 Lomax field recording', () => {
    expect(proposeDelivery(load('lomaxbib000533'))).toBe('selfhost');
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `nix develop --command pnpm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/rights.mjs tests/rights.test.ts
git commit -m "feat: rights rule proposing a delivery mode per recording"
```

---

### Task 8: `fetch-loc.mjs` refreshes metadata without touching vetting fields

**Files:**
- Create: `scripts/lib/manifest.mjs`, `scripts/fetch-loc.mjs`, `tests/manifest.test.ts`

**Interfaces:**
- Consumes: `parseItem` (Task 6), `proposeDelivery` (Task 7), `fetchJson` (Task 4).
- Produces:
  - `readManifest(path: string): object[]` and `writeManifest(path: string, entries: object[]): void` from `scripts/lib/manifest.mjs`.
  - `refreshEntry(entry: object, parsed: object | null, today: string): object` from the same module — returns a new entry with only `loc` and, when absent, `delivery` changed.

- [ ] **Step 1: Write the failing manifest test**

The load-bearing property: a refresh must never alter `status`, `note`, or an
already-set `delivery`.

`tests/manifest.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readManifest, refreshEntry, writeManifest } from '../scripts/lib/manifest.mjs';

const parsed = {
  title: 'Steal away', date: '1902-10-29', collection: 'national jukebox',
  performers: ['Fisk University Jubilee Quartet'], place: null,
  duration_seconds: 150, audio_url: 'https://tile.loc.gov/new.mp3',
  can_download: true, rights: 'No known restrictions.',
  item_url: 'https://www.loc.gov/item/jukebox-4649/',
};

describe('refreshEntry', () => {
  const human = {
    song: 'steal-away', loc_id: 'jukebox-4649',
    status: 'approved', delivery: 'stream',
    note: 'Teacher note that must survive.',
    loc: { ...parsed, audio_url: 'https://tile.loc.gov/old.mp3', checked: '2020-01-01' },
  };

  it('replaces the loc block', () => {
    const out = refreshEntry(human, parsed, '2026-10-07');
    expect(out.loc.audio_url).toBe('https://tile.loc.gov/new.mp3');
    expect(out.loc.checked).toBe('2026-10-07');
  });

  it('never changes status', () => {
    expect(refreshEntry(human, parsed, '2026-10-07').status).toBe('approved');
  });

  it('never changes a note', () => {
    expect(refreshEntry(human, parsed, '2026-10-07').note)
      .toBe('Teacher note that must survive.');
  });

  it('never overwrites a delivery a human already set', () => {
    // The rule would propose selfhost here; the human said stream.
    expect(refreshEntry(human, parsed, '2026-10-07').delivery).toBe('stream');
  });

  it('proposes a delivery only when the field is null', () => {
    const fresh = { ...human, delivery: null };
    expect(refreshEntry(fresh, parsed, '2026-10-07').delivery).toBe('selfhost');
  });

  it('leaves the existing loc block alone when the item has no audio', () => {
    const out = refreshEntry(human, null, '2026-10-07');
    expect(out.loc.audio_url).toBe('https://tile.loc.gov/old.mp3');
  });

  it('does not invent a loc block for an item with no audio', () => {
    const bare = { ...human, loc: null };
    expect(refreshEntry(bare, null, '2026-10-07').loc).toBeNull();
  });
});

describe('readManifest and writeManifest', () => {
  it('round-trips an entry without losing or reordering keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dubois-'));
    const path = join(dir, 'recordings.yaml');
    const entries = [{
      song: 'steal-away', loc_id: 'jukebox-4649', status: 'approved',
      delivery: 'selfhost', note: 'A note.', loc: { ...parsed, checked: '2026-10-07' },
    }];
    writeManifest(path, entries);
    expect(readManifest(path)).toEqual(entries);
  });

  it('preserves an apostrophe in a note', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dubois-'));
    const path = join(dir, 'recordings.yaml');
    const entries = [{
      song: 'steal-away', loc_id: 'x', status: 'rejected',
      delivery: null, note: "Piano only; there's no voice on this one.", loc: null,
    }];
    writeManifest(path, entries);
    expect(readManifest(path)[0].note)
      .toBe("Piano only; there's no voice on this one.");
  });

  it('writes the header comment that tells a human which fields are theirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dubois-'));
    const path = join(dir, 'recordings.yaml');
    writeManifest(path, []);
    const text = readFileSync(path, 'utf8');
    expect(text).toMatch(/You own `status`, `delivery` and `note`/);
  });

  it('returns an empty array for a manifest holding only comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dubois-'));
    const path = join(dir, 'recordings.yaml');
    writeFileSync(path, '# nothing here yet\n');
    expect(readManifest(path)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `nix develop --command pnpm test -- manifest`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `scripts/lib/manifest.mjs`**

```js
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
`;

export function readManifest(path) {
  const parsed = parse(readFileSync(path, 'utf8'));
  return parsed ?? [];
}

/**
 * Rewriting the whole file loses hand-written comments, so the header is
 * re-emitted every time and per-entry commentary belongs in `note` rather
 * than in a YAML comment. The header says so.
 */
export function writeManifest(path, entries) {
  writeFileSync(path, HEADER + stringify(entries, { lineWidth: 0 }));
}

/**
 * Refresh one entry from freshly parsed loc.gov metadata.
 *
 * This function is the guarantee the design makes to the person vetting:
 * `status` and `note` are returned untouched, and `delivery` is only ever
 * filled in when it is null. A null `parsed` means the item exposed no audio,
 * in which case we keep whatever we already had rather than destroying it.
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
```

- [ ] **Step 4: Run the manifest tests**

Run: `nix develop --command pnpm test -- manifest`
Expected: PASS, 11 assertions.

- [ ] **Step 5: Write `scripts/fetch-loc.mjs`**

```js
import { readManifest, refreshEntry, writeManifest } from './lib/manifest.mjs';
import { parseItem } from './lib/loc-parse.mjs';
import { fetchJson } from './lib/http.mjs';

const MANIFEST = 'src/data/recordings.yaml';

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
```

- [ ] **Step 6: Run it against the three seeded entries**

Run: `nix develop --command pnpm fetch:loc`
Expected: `Refreshed 3 entries: 0 approved, 3 unreviewed, 0 rejected.` and
`src/data/recordings.yaml` now holds a full `loc:` block and a proposed
`delivery` for each.

- [ ] **Step 7: Check the proposals by eye**

Run: `grep -E 'loc_id|delivery|date:' src/data/recordings.yaml`
Expected: all three propose `selfhost` — the two Jukebox sides are 1909 and
1917, and the Lomax item carries a no-known-restrictions statement.

- [ ] **Step 8: Run the tests and the build**

Run:
```bash
nix develop --command pnpm test
nix develop --command pnpm build
```
Expected: all PASS. The build still succeeds, because nothing is `approved`.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/manifest.mjs scripts/fetch-loc.mjs tests/manifest.test.ts \
        src/data/recordings.yaml
git commit -m "feat: refresh loc.gov metadata without touching vetting fields"
```

---

### Task 9: Download audio and render the recordings

**Files:**
- Create: `scripts/fetch-audio.mjs`, `src/components/RecordingList.astro`, `src/components/audio-exclusive.ts`, `tests/fetch-audio.test.ts`
- Modify: `src/pages/chapter/[n].astro`, `src/data/recordings.yaml`

**Interfaces:**
- Consumes: `readManifest` (Task 8), `fetchBinary` (Task 4), the `recordings` and `songs` collections (Tasks 2–3).
- Produces:
  - `audioFilename(entry: { song: string, loc_id: string }): string` from `scripts/fetch-audio.mjs` — returns `<song>--<loc_id>.mp3`.
  - `checkDownload(buf: Buffer, declared: number | null, url: string): void` from the same module — throws on a short or empty body.
  - `RecordingList.astro`, taking props `{ recordings: RecordingEntry[] }`.

- [ ] **Step 1: Write the failing download-guard test**

This is Review Focus item 5. A build that ships a truncated MP3 is the exact
failure the spec forbids.

`tests/fetch-audio.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { audioFilename, checkDownload } from '../scripts/fetch-audio.mjs';

describe('audioFilename', () => {
  it('joins the song slug and the loc id', () => {
    expect(audioFilename({ song: 'steal-away', loc_id: 'jukebox-4649' }))
      .toBe('steal-away--jukebox-4649.mp3');
  });

  it('keeps two recordings of one song apart', () => {
    const a = audioFilename({ song: 'steal-away', loc_id: 'jukebox-4649' });
    const b = audioFilename({ song: 'steal-away', loc_id: 'jukebox-9999' });
    expect(a).not.toBe(b);
  });

  it('produces a filename with no characters that need escaping', () => {
    const name = audioFilename({
      song: 'nobody-knows-the-trouble-ive-seen', loc_id: 'jukebox-879940',
    });
    expect(name).toMatch(/^[a-z0-9.-]+$/);
  });
});

describe('checkDownload', () => {
  const url = 'https://tile.loc.gov/x.mp3';

  it('accepts a body matching the declared length', () => {
    const buf = Buffer.alloc(5000, 1);
    expect(() => checkDownload(buf, 5000, url)).not.toThrow();
  });

  it('rejects a body shorter than the declared length', () => {
    const buf = Buffer.alloc(2000, 1);
    expect(() => checkDownload(buf, 5000, url)).toThrow(/truncated/i);
  });

  it('names the url when it rejects a truncated body', () => {
    expect(() => checkDownload(Buffer.alloc(10), 5000, url)).toThrow(/tile\.loc\.gov/);
  });

  it('rejects an empty body', () => {
    expect(() => checkDownload(Buffer.alloc(0), null, url)).toThrow(/empty/i);
  });

  it('rejects a body too small to be a real recording', () => {
    // An HTML error page served with a 200 lands here.
    expect(() => checkDownload(Buffer.alloc(900), null, url)).toThrow(/too small/i);
  });

  it('accepts a long body when the server declares no length', () => {
    expect(() => checkDownload(Buffer.alloc(200_000, 1), null, url)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `nix develop --command pnpm test -- fetch-audio`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `scripts/fetch-audio.mjs`**

```js
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { readManifest } from './lib/manifest.mjs';
import { fetchBinary } from './lib/http.mjs';

const MANIFEST = 'src/data/recordings.yaml';
const OUT_DIR = 'public/audio';

// Below this, the body is an error page or a stub rather than a recording.
const MIN_BYTES = 1024;

export function audioFilename(entry) {
  return `${entry.song}--${entry.loc_id}.mp3`;
}

/**
 * The spec forbids shipping a silent file, so a short body is a hard error
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
```

- [ ] **Step 4: Run the tests**

Run: `nix develop --command pnpm test -- fetch-audio`
Expected: PASS, 9 assertions.

- [ ] **Step 5: Approve the three seeded recordings**

Edit `src/data/recordings.yaml` by hand. For each of the three entries, set
`status: approved` and write a `note`. Leave the `delivery` values the script
proposed. Example for the first:

```yaml
- song: nobody-knows-the-trouble-ive-seen
  loc_id: jukebox-879940
  status: approved
  delivery: selfhost
  note: >-
    Fisk University Jubilee Quartet, recorded 1917. A trained studio quartet
    singing in close harmony. Compare it with the congregation in chapter 2.
```

- [ ] **Step 6: Download the audio**

Run: `nix develop --command pnpm fetch:audio`
Expected: three MP3s in `public/audio/`, each a few megabytes.

Run it a second time. Expected: `Fetched 0, already present 3, of 3.` This is
the idempotence the Global Constraints require.

- [ ] **Step 7: Write `src/components/audio-exclusive.ts`**

```ts
/**
 * The only client-side script in the project. When a student starts one
 * recording, pause the others, so two performances of the same spiritual
 * cannot play over each other.
 */
document.addEventListener(
  'play',
  (event) => {
    const started = event.target;
    if (!(started instanceof HTMLAudioElement)) return;
    for (const other of document.querySelectorAll('audio')) {
      if (other !== started) other.pause();
    }
  },
  true, // capture, because `play` does not bubble
);
```

- [ ] **Step 8: Write `src/components/RecordingList.astro`**

```astro
---
import { audioFilename } from '../../scripts/fetch-audio.mjs';

interface Recording {
  loc_id: string;
  song: string;
  delivery: 'selfhost' | 'stream';
  note: string | null;
  loc: {
    title: string;
    date: string | null;
    performers: string[];
    place: string | null;
    duration_seconds: number | null;
    audio_url: string;
    rights: string;
    item_url: string;
  };
}

interface Props {
  recordings: Recording[];
  songTitle: string;
}

const { recordings, songTitle } = Astro.props;

const year = (date: string | null) => (date ? date.slice(0, 4) : 'date unknown');
const who = (r: Recording) =>
  r.loc.performers.length > 0 ? r.loc.performers.join(', ') : 'performer unnamed';
const src = (r: Recording) =>
  r.delivery === 'selfhost' ? `/audio/${audioFilename(r)}` : r.loc.audio_url;
---
{recordings.length === 0 ? (
  <p class="none">
    No vetted recording of <cite>{songTitle}</cite> yet. The Library of Congress
    may not hold one.
  </p>
) : (
  <section class="recordings" aria-label={`Recordings of ${songTitle}`}>
    <h2>Recordings of <cite>{songTitle}</cite></h2>
    <ol>
      {recordings.map((r) => (
        <li>
          <p class="cite">
            <strong>{who(r)}</strong>, {year(r.loc.date)}
            {r.loc.place && <> · {r.loc.place}</>}
          </p>
          {r.note && <p class="note">{r.note}</p>}
          <audio
            controls
            preload="none"
            src={src(r)}
            aria-label={`${songTitle}, performed by ${who(r)}, ${year(r.loc.date)}`}
          ></audio>
          <p class="source">
            <a href={r.loc.item_url}>Library of Congress item {r.loc_id}</a>
            {r.delivery === 'stream' && <> · streamed from loc.gov</>}
          </p>
        </li>
      ))}
    </ol>
    <style>
      .recordings { margin: 2rem 0; padding: 1rem 0; border-top: 1px solid; border-bottom: 1px solid; }
      .recordings ol { list-style: none; padding: 0; }
      .recordings li + li { margin-top: 1.5rem; }
      .cite { margin: 0; }
      .note { font-size: .95rem; font-style: italic; margin: .25rem 0; }
      .source { font-size: .85rem; margin: .25rem 0 0; }
      audio { width: 100%; margin-top: .5rem; }
      .none { font-style: italic; }
    </style>
  </section>
)}
```

- [ ] **Step 9: Wire the recordings into the chapter page**

Replace `src/pages/chapter/[n].astro` with:

```astro
---
import { getCollection, render } from 'astro:content';
import Base from '../../layouts/Base.astro';
import RecordingList from '../../components/RecordingList.astro';

export async function getStaticPaths() {
  const chapters = await getCollection('chapters', (c) => c.data.chapter !== null);
  const songs = await getCollection('songs');
  const recordings = await getCollection('recordings', (r) => r.data.status === 'approved');

  return chapters.map((entry) => ({
    params: { n: String(entry.data.chapter) },
    props: {
      entry,
      songs: songs
        .filter((s) => s.data.chapter === entry.data.chapter)
        .map((s) => ({
          title: s.data.title,
          recordings: recordings.filter((r) => r.data.song === s.data.slug).map((r) => r.data),
        })),
    },
  }));
}

const { entry, songs } = Astro.props;
const { Content } = await render(entry);
const n = entry.data.chapter!;
---
<Base title={`${n}. ${entry.data.heading} — The Souls of Black Folk`}>
  <p class="eyebrow">Chapter {n}</p>
  <h1>{entry.data.heading}</h1>

  {songs.map((song) => (
    <RecordingList recordings={song.recordings} songTitle={song.title} />
  ))}

  <article><Content /></article>

  <nav class="chapter-nav">
    {n > 1 && <a href={`/chapter/${n - 1}/`} rel="prev">Previous chapter</a>}
    {n < 14 && <a href={`/chapter/${n + 1}/`} rel="next">Next chapter</a>}
    {n === 14 && <a href="/afterthought/" rel="next">The Afterthought</a>}
  </nav>

  <script>
    import '../../components/audio-exclusive.ts';
  </script>

  <style>
    .eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: .8rem; }
    .chapter-nav { display: flex; justify-content: space-between; margin-top: 3rem; }
  </style>
</Base>
```

- [ ] **Step 10: Build and check the rendered players**

Run:
```bash
nix develop --command pnpm build
grep -o 'src="/audio/[^"]*"' dist/chapter/1/index.html
grep -c 'No vetted recording' dist/chapter/5/index.html
```
Expected: chapter 1 holds `src="/audio/nobody-knows-the-trouble-ive-seen--jukebox-879940.mp3"`;
chapter 5 shows the no-recording line, because nothing is approved for it yet.

- [ ] **Step 11: Check chapter 14 shows five songs**

Run: `grep -c 'Recordings of' dist/chapter/14/index.html`
Expected: 0, because none of chapter 14's five songs has an approved recording
yet. Then run `grep -c 'No vetted recording' dist/chapter/14/index.html`.
Expected: 5, one per song.

- [ ] **Step 12: Commit**

```bash
git add scripts/fetch-audio.mjs src/components/ src/pages/chapter/ \
        tests/fetch-audio.test.ts src/data/recordings.yaml
git commit -m "feat: download approved audio and render the recordings block"
```

---

### Task 10: Crop the epigraph notation from the 1903 scan

**Files:**
- Create: `scripts/crop-scans.mjs`, `src/components/Epigraph.astro`
- Modify: `src/data/songs.yaml`, `src/pages/chapter/[n].astro`

**Interfaces:**
- Consumes: the `songs` collection (Task 2), `fetchBinary` (Task 4).
- Produces:
  - `notationFilename(slug: string): string` from `scripts/crop-scans.mjs` — returns `<slug>.png`.
  - `iiifUrl(iaItem: string, page: number): string` from the same module.
  - `Epigraph.astro`, taking props `{ songTitle: string, notation: ImageMetadata | null, iaItem: string | null, page: number | null }`.

- [ ] **Step 1: Write `scripts/crop-scans.mjs`**

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { fetchBinary } from './lib/http.mjs';

const SONGS = 'src/data/songs.yaml';
const OUT_DIR = 'src/assets/notation';

export const notationFilename = (slug) => `${slug}.png`;

/**
 * One page at a time through the Internet Archive IIIF endpoint. The
 * alternative is downloading the whole 288-page JP2 bundle, which is far more
 * bytes for the fourteen pages we need.
 */
export const iiifUrl = (iaItem, page) =>
  `https://iiif.archive.org/iiif/${iaItem}$${page}/full/full/0/default.jpg`;

async function main() {
  const songs = parse(readFileSync(SONGS, 'utf8')).filter((s) => s.scan !== null);
  mkdirSync(OUT_DIR, { recursive: true });

  if (songs.length === 0) {
    console.log('No songs have scan coordinates yet. Nothing to crop.');
    return;
  }

  const failures = [];
  for (const song of songs) {
    const { ia_item, page, crop } = song.scan;
    const [left, top, right, bottom] = crop;
    try {
      const { buf } = await fetchBinary(iiifUrl(ia_item, page));
      const out = await sharp(buf)
        .extract({ left, top, width: right - left, height: bottom - top })
        .png({ compressionLevel: 9 })
        .toBuffer();
      writeFileSync(`${OUT_DIR}/${notationFilename(song.slug)}`, out);
      console.log(`  ${notationFilename(song.slug)}  page ${page}`);
    } catch (err) {
      failures.push(`${song.slug} (page ${page}): ${err.message}`);
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
```

- [ ] **Step 2: Find the page index of each epigraph**

This step is inspection, not code. For each of the 14 chapter epigraphs:

```bash
nix develop --command node -e "
  const { iiifUrl } = await import('./scripts/crop-scans.mjs');
  console.log(iiifUrl('cu31924024920492', 40));
"
```

Open the printed URL in a browser, step the page number until you find the
chapter head, then note the page index. The scan holds 288 images and the book
has 14 chapters, so expect the heads to fall roughly 20 pages apart.

Record each index in `src/data/songs.yaml`, replacing `scan: null`:

```yaml
  scan:
    ia_item: cu31924024920492
    page: 41
    crop: [0, 0, 0, 0]
```

- [ ] **Step 3: Find each crop box**

For each page, fetch it once and read its dimensions, then crop by trial:

```bash
nix develop --command node -e "
  const sharp = (await import('sharp')).default;
  const { fetchBinary } = await import('./scripts/lib/http.mjs');
  const { iiifUrl } = await import('./scripts/crop-scans.mjs');
  const { buf } = await fetchBinary(iiifUrl('cu31924024920492', 41));
  console.log(await sharp(buf).metadata());
"
```

Set the crop box to the staff only — not the verse above it, which the page
renders as text. Then run `pnpm fetch:scans` and look at the PNG.

- [ ] **Step 4: Crop them all**

Run: `nix develop --command pnpm fetch:scans`
Expected: `Cropped 14 of 14.` and 14 PNGs in `src/assets/notation/`.

Chapter 14's four extra songs keep `scan: null` — Du Bois prints their
notation inside the chapter text rather than as an epigraph, so they get no
cropped staff.

- [ ] **Step 5: Write `src/components/Epigraph.astro`**

```astro
---
import { Image } from 'astro:assets';

interface Props {
  songTitle: string;
  notation: ImageMetadata | null;
  iaItem: string | null;
  page: number | null;
}

const { songTitle, notation, iaItem, page } = Astro.props;
---
{notation && (
  <figure class="epigraph">
    <Image
      src={notation}
      alt={`A bar of musical notation for the spiritual "${songTitle}", printed without words at the head of this chapter in the 1903 edition.`}
      widths={[480, 960]}
      sizes="(max-width: 40rem) 100vw, 40rem"
    />
    <figcaption>
      <cite>{songTitle}</cite>, as Du Bois printed it.
      {iaItem && page && (
        <>
          {' '}From the 1903 first edition,
          <a href={`https://archive.org/details/${iaItem}/page/n${page}`}>
            page scan at the Internet Archive</a>.
        </>
      )}
    </figcaption>
    <style>
      .epigraph { margin: 2rem 0; }
      .epigraph img { width: 100%; height: auto; }
      .epigraph figcaption { font-size: .85rem; opacity: .85; margin-top: .5rem; }
    </style>
  </figure>
)}
```

- [ ] **Step 6: Show the epigraph on the chapter page**

In `src/pages/chapter/[n].astro`, import the notation images and pass them
through. Add to the frontmatter of `getStaticPaths`:

```ts
const notation = import.meta.glob<{ default: ImageMetadata }>(
  '../../assets/notation/*.png',
);
```

and include it in each song's props:

```ts
        .map((s) => ({
          title: s.data.title,
          slug: s.data.slug,
          scan: s.data.scan,
          notationLoader: notation[`../../assets/notation/${s.data.slug}.png`] ?? null,
          recordings: recordings.filter((r) => r.data.song === s.data.slug).map((r) => r.data),
        })),
```

Then in the template, above `<RecordingList>`:

```astro
{songs.map((song) => (
  <>
    <Epigraph
      songTitle={song.title}
      notation={song.notationLoader ? (await song.notationLoader()).default : null}
      iaItem={song.scan?.ia_item ?? null}
      page={song.scan?.page ?? null}
    />
    <RecordingList recordings={song.recordings} songTitle={song.title} />
  </>
))}
```

Note: `import.meta.glob` without `{ eager: true }` returns loader functions,
so the `await` above is required. If Astro rejects `await` inside the map, add
`{ eager: true }` to the glob and read `.default` directly.

- [ ] **Step 7: Build and check**

Run:
```bash
nix develop --command pnpm build
grep -o '<figure class="epigraph">' dist/chapter/1/index.html
grep -o 'alt="A bar of musical notation[^"]*"' dist/chapter/1/index.html
```
Expected: both grep calls return a match.

- [ ] **Step 8: Run the typecheck and tests**

Run:
```bash
nix develop --command pnpm check
nix develop --command pnpm test
```
Expected: 0 errors, all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/crop-scans.mjs src/components/Epigraph.astro \
        src/data/songs.yaml src/pages/chapter/
git commit -m "feat: crop the 1903 epigraph notation and show it per chapter"
```

---

### Task 11: `find-recordings.mjs` proposes candidates

**Files:**
- Create: `scripts/find-recordings.mjs`, `tests/find-recordings.test.ts`, `tests/fixtures/loc/search-steal-away.json`

**Interfaces:**
- Consumes: `readManifest`, `writeManifest` (Task 8), `fetchJson` (Task 4).
- Produces:
  - `idFromResult(result: { id: string }): string | null` from `scripts/find-recordings.mjs` — pulls `jukebox-4649` out of `http://www.loc.gov/item/jukebox-4649/`.
  - `newCandidates(results: object[], songSlug: string, existingIds: Set<string>): object[]` from the same module.

- [ ] **Step 1: Save the search fixture**

Run:
```bash
nix develop --command node -e "
  const fs=require('node:fs');
  const u='https://www.loc.gov/audio/?q=steal+away&fo=json&c=20&at=results';
  fetch(u,{headers:{'User-Agent':'dubois-outloud/1.0 (zach.thomas@hey.com)'}})
    .then(r=>r.json()).then(j=>{
      fs.writeFileSync('tests/fixtures/loc/search-steal-away.json', JSON.stringify(j,null,2));
      console.log('results', j.results.length);
    });
"
```
Expected: a file holding a `results` array.

- [ ] **Step 2: Write the failing test**

This is Review Focus item 3, second half: a re-run must not re-append a
candidate already in the manifest.

`tests/find-recordings.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { idFromResult, newCandidates } from '../scripts/find-recordings.mjs';

const search = JSON.parse(
  readFileSync('tests/fixtures/loc/search-steal-away.json', 'utf8'),
);

describe('idFromResult', () => {
  it('extracts the item id from an http url', () => {
    expect(idFromResult({ id: 'http://www.loc.gov/item/jukebox-4649/' }))
      .toBe('jukebox-4649');
  });

  it('extracts the item id from an https url', () => {
    expect(idFromResult({ id: 'https://www.loc.gov/item/lomaxbib000533/' }))
      .toBe('lomaxbib000533');
  });

  it('returns null for a result that is not an item', () => {
    expect(idFromResult({ id: 'http://www.loc.gov/collections/national-jukebox/' }))
      .toBeNull();
  });

  it('returns null for a missing id', () => {
    expect(idFromResult({})).toBeNull();
  });
});

describe('newCandidates', () => {
  it('turns search results into unreviewed entries', () => {
    const out = newCandidates(search.results, 'steal-away', new Set());
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) {
      expect(e.status).toBe('unreviewed');
      expect(e.song).toBe('steal-away');
      expect(e.delivery).toBeNull();
      expect(e.note).toBeNull();
      expect(e.loc).toBeNull();
    }
  });

  it('skips an id already in the manifest', () => {
    const all = newCandidates(search.results, 'steal-away', new Set());
    const skipOne = new Set([all[0].loc_id]);
    const out = newCandidates(search.results, 'steal-away', skipOne);
    expect(out.map((e) => e.loc_id)).not.toContain(all[0].loc_id);
    expect(out).toHaveLength(all.length - 1);
  });

  it('returns nothing when every id is already known', () => {
    const all = newCandidates(search.results, 'steal-away', new Set());
    const known = new Set(all.map((e) => e.loc_id));
    expect(newCandidates(search.results, 'steal-away', known)).toEqual([]);
  });

  it('never emits the same id twice from one result set', () => {
    const doubled = [...search.results, ...search.results];
    const out = newCandidates(doubled, 'steal-away', new Set());
    const ids = out.map((e) => e.loc_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps only results that loc.gov marks as audio', () => {
    const notAudio = [{ id: 'http://www.loc.gov/item/x-1/', online_format: ['image'] }];
    expect(newCandidates(notAudio, 'steal-away', new Set())).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `nix develop --command pnpm test -- find-recordings`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `scripts/find-recordings.mjs`**

```js
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { readManifest, writeManifest } from './lib/manifest.mjs';
import { fetchJson } from './lib/http.mjs';

const SONGS = 'src/data/songs.yaml';
const MANIFEST = 'src/data/recordings.yaml';

export function idFromResult(result) {
  const m = String(result.id ?? '').match(/\/item\/([^/]+)\/?$/);
  return m ? m[1] : null;
}

function isAudio(result) {
  const formats = result.online_format ?? [];
  return Array.isArray(formats) ? formats.includes('audio') : formats === 'audio';
}

/**
 * Search results -> unreviewed manifest entries.
 *
 * `existingIds` is every loc_id already in the manifest, including rejected
 * ones. Skipping them is what makes a re-run safe: a recording the human
 * already turned down must not reappear as a fresh candidate.
 */
export function newCandidates(results, songSlug, existingIds) {
  const out = [];
  const seen = new Set(existingIds);
  for (const result of results) {
    if (!isAudio(result)) continue;
    const locId = idFromResult(result);
    if (locId === null || seen.has(locId)) continue;
    seen.add(locId);
    out.push({
      song: songSlug, loc_id: locId, status: 'unreviewed',
      delivery: null, note: null, loc: null,
    });
  }
  return out;
}

async function main() {
  const songs = parse(readFileSync(SONGS, 'utf8'));
  const manifest = readManifest(MANIFEST);
  const existingIds = new Set(manifest.map((e) => e.loc_id));

  let added = 0;
  for (const song of songs) {
    const query = encodeURIComponent(song.title.replace(/['"]/g, ''));
    const url = `https://www.loc.gov/audio/?q=${query}&fo=json&c=20&at=results`;
    let results = [];
    try {
      results = (await fetchJson(url)).results ?? [];
    } catch (err) {
      console.warn(`  ${song.slug}: search failed, ${err.message}`);
      continue;
    }
    const candidates = newCandidates(results, song.slug, existingIds);
    for (const c of candidates) existingIds.add(c.loc_id);
    manifest.push(...candidates);
    added += candidates.length;
    console.log(`  ${song.slug}: ${candidates.length} new of ${results.length} results`);
  }

  writeManifest(MANIFEST, manifest);
  console.log(
    `\nAdded ${added} candidates. They are all status: unreviewed.\n` +
      `Run \`pnpm fetch:loc\` to fill in their metadata, then vet them.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
```

- [ ] **Step 5: Run the tests**

Run: `nix develop --command pnpm test -- find-recordings`
Expected: PASS, 10 assertions.

- [ ] **Step 6: Run the discovery pass for real**

Run:
```bash
nix develop --command pnpm find:recordings
nix develop --command pnpm fetch:loc
```
Expected: a few hundred `unreviewed` entries, each with a filled `loc:` block.
The build still succeeds, because unreviewed entries are exempt.

- [ ] **Step 7: Confirm a re-run adds nothing**

Run: `nix develop --command pnpm find:recordings`
Expected: every line reports `0 new`, and `Added 0 candidates.`

- [ ] **Step 8: Commit**

```bash
git add scripts/find-recordings.mjs tests/find-recordings.test.ts \
        tests/fixtures/loc/search-steal-away.json src/data/recordings.yaml
git commit -m "feat: discovery pass proposing loc.gov candidates per song"
```

---

### Task 12: The table of songs and the about page

**Files:**
- Create: `src/pages/songs.astro`, `src/pages/about.astro`

**Interfaces:**
- Consumes: the `songs` and `recordings` collections.
- Produces: routes `/songs/` and `/about/`.

- [ ] **Step 1: Write `src/pages/songs.astro`**

```astro
---
import { getCollection } from 'astro:content';
import Base from '../layouts/Base.astro';

const songs = (await getCollection('songs')).sort(
  (a, b) => a.data.chapter - b.data.chapter,
);
const approved = await getCollection('recordings', (r) => r.data.status === 'approved');

const forSong = (slug: string) => approved.filter((r) => r.data.song === slug);
const year = (d: string | null) => (d ? d.slice(0, 4) : '—');
---
<Base
  title="Table of the songs — The Souls of Black Folk"
  description="Every spiritual Du Bois placed at a chapter head, with the vetted Library of Congress recordings of each."
>
  <h1>Table of the songs</h1>
  <p>
    Du Bois opened each chapter with a verse and a bar of music. This table
    lists each spiritual and every recording we vetted for it.
  </p>

  <table>
    <thead>
      <tr><th>Ch.</th><th>Spiritual</th><th>Recordings</th></tr>
    </thead>
    <tbody>
      {songs.map((s) => (
        <tr>
          <td><a href={`/chapter/${s.data.chapter}/`}>{s.data.chapter}</a></td>
          <td><cite>{s.data.title}</cite></td>
          <td>
            {forSong(s.data.slug).length === 0 ? (
              <span class="none">none yet</span>
            ) : (
              <ul>
                {forSong(s.data.slug).map((r) => (
                  <li>
                    <a href={r.data.loc.item_url}>
                      {r.data.loc.performers[0] ?? r.data.loc.title}
                    </a>, {year(r.data.loc.date)}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  </table>

  <style>
    .table-wrap { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; font-size: .95rem; }
    th, td { text-align: left; vertical-align: top; padding: .5rem .4rem; border-bottom: 1px solid; }
    td ul { margin: 0; padding-left: 1rem; }
    .none { font-style: italic; opacity: .7; }
  </style>
</Base>
```

- [ ] **Step 2: Write `src/pages/about.astro`**

This is the page the spec calls out as the one a district librarian reads, so
it lists every rights statement verbatim.

```astro
---
import { getCollection } from 'astro:content';
import Base from '../layouts/Base.astro';

const approved = await getCollection('recordings', (r) => r.data.status === 'approved');
const selfhosted = approved.filter((r) => r.data.delivery === 'selfhost');
const streamed = approved.filter((r) => r.data.delivery === 'stream');

// One block per distinct rights statement, so the page does not repeat itself
// once per recording.
const byRights = new Map<string, typeof approved>();
for (const r of approved) {
  const key = r.data.loc.rights;
  byRights.set(key, [...(byRights.get(key) ?? []), r]);
}
---
<Base title="Sources and rights — The Souls of Black Folk">
  <h1>Sources and rights</h1>

  <h2>The text</h2>
  <p>
    W. E. B. Du Bois, <cite>The Souls of Black Folk: Essays and Sketches</cite>,
    Chicago, A. C. McClurg &amp; Co., 1903. The text comes from
    <a href="https://www.gutenberg.org/ebooks/408">Project Gutenberg eBook 408</a>
    and is in the public domain.
  </p>

  <h2>The notation</h2>
  <p>
    Each chapter head shows a bar of music cropped from a scan of the 1903 first
    edition, held by the Internet Archive as item
    <a href="https://archive.org/details/cu31924024920492">cu31924024920492</a>.
    The 1903 engravings are in the public domain.
  </p>

  <h2>The recordings</h2>
  <p>
    All {approved.length} recordings come from the Library of Congress.
    {selfhosted.length} are served from this site and {streamed.length} stream
    from loc.gov. A recording that streams does so because its rights status
    does not clearly permit redistribution. If your school network blocks
    loc.gov, those players will fail while the rest of the site works; the item
    link beside each one still reaches the Library.
  </p>

  {[...byRights.entries()].map(([rights, items]) => (
    <section class="rights">
      <blockquote>{rights}</blockquote>
      <p class="applies">Applies to:</p>
      <ul>
        {items.map((r) => (
          <li>
            <a href={r.data.loc.item_url}>{r.data.loc.title}</a>
            {r.data.loc.date && <>, {r.data.loc.date.slice(0, 4)}</>}
            {' '}— served {r.data.delivery === 'selfhost' ? 'from this site' : 'from loc.gov'}
          </li>
        ))}
      </ul>
    </section>
  ))}

  <h2>How this site was built</h2>
  <p>
    A static site generated from two YAML manifests. The source, including the
    full list of every recording considered and rejected, is at
    <a href="https://github.com/OWNER/dubois-outloud">github.com/OWNER/dubois-outloud</a>.
  </p>
  <p>
    The chapter-to-song pairing follows the 1903 edition. The musical hypertext
    edition at <a href="https://way.net/SoulsOfBlackFolk/">way.net</a> first set
    the book out this way online.
  </p>

  <h2>A note on rights</h2>
  <p>
    Recordings dated before 1923 are treated as public domain under the Music
    Modernization Act. This is an editorial judgment, not legal advice. Every
    rights statement above is quoted verbatim from the Library of Congress
    record, so you can check our reading against the source.
  </p>

  <style>
    .rights { margin: 1.5rem 0; }
    .rights blockquote {
      margin: 0; padding: .75rem 1rem; border-left: 3px solid;
      font-size: .9rem;
    }
    .applies { margin: .5rem 0 .25rem; font-size: .85rem; text-transform: uppercase; letter-spacing: .06em; }
    .rights ul { margin: 0; font-size: .9rem; }
  </style>
</Base>
```

Replace `OWNER` with the real GitHub owner once the repository exists.

- [ ] **Step 3: Build and check both pages**

Run:
```bash
nix develop --command pnpm build
grep -c '<cite>' dist/songs/index.html
grep -c 'Music Modernization Act' dist/about/index.html
```
Expected: the first returns at least 18; the second returns at least 1.

- [ ] **Step 4: Check every song appears in the table**

Run: `grep -o 'none yet' dist/songs/index.html | wc -l`
Expected: 15 at this point — 18 songs minus the 3 approved recordings.

- [ ] **Step 5: Run the typecheck and tests**

Run:
```bash
nix develop --command pnpm check
nix develop --command pnpm test
```
Expected: 0 errors, all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/songs.astro src/pages/about.astro
git commit -m "feat: table of songs and a sources-and-rights page"
```

---

### Task 13: End-to-end build check from a fixture manifest

The spec requires one check that builds the whole site from a two-song fixture
manifest and asserts the rendered chapter page is correct. Every other test is
a unit test; this is the only one that proves the pieces fit.

**Files:**
- Create: `tests/fixtures/site/songs.yaml`, `tests/fixtures/site/recordings.yaml`, `tests/build-e2e.test.ts`
- Modify: `src/content.config.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–12.
- Produces: `DUBOIS_DATA_DIR`, an environment variable that points the two
  collections at a different data directory. It defaults to `src/data`, so
  nothing about a normal build changes.

- [ ] **Step 1: Make the data directory overridable**

The test must never write to `src/data/`. A test that copies a fixture over the
real manifest and restores it afterwards destroys the maintainer's work in
progress if it crashes partway. Reading the directory from the environment
removes that whole failure mode.

In `src/content.config.ts`, replace the two hard-coded paths:

```ts
// Defaults to the real manifests. tests/build-e2e.test.ts points this at a
// fixture directory so an end-to-end build never touches src/data/.
const DATA_DIR = process.env.DUBOIS_DATA_DIR ?? 'src/data';
```

Then use `` `${DATA_DIR}/songs.yaml` `` and `` `${DATA_DIR}/recordings.yaml` ``
in both `file()` loaders, and `` `${DATA_DIR}/songs.yaml` `` in the
`readFileSync` call inside the recordings parser.

- [ ] **Step 2: Confirm a normal build is unchanged**

Run: `nix develop --command pnpm build`
Expected: succeeds exactly as before, with the same page count.

- [ ] **Step 3: Write the fixture manifests**

`tests/fixtures/site/songs.yaml` — two songs, both on chapter 1, so one page
exercises the multi-song path that chapter 14 needs:

```yaml
- slug: steal-away
  chapter: 1
  title: "Steal Away"
  scan: null
- slug: poor-rosy
  chapter: 1
  title: "Poor Rosy"
  scan: null
```

`tests/fixtures/site/recordings.yaml` — one self-hosted recording, one
streamed, and one song with nothing approved:

```yaml
- song: steal-away
  loc_id: jukebox-4649
  status: approved
  delivery: selfhost
  note: "A note that must reach the page."
  loc:
    title: "Steal away"
    date: "1902-10-29"
    collection: "national jukebox"
    performers: ["Fisk University Jubilee Quartet"]
    place: null
    duration_seconds: 150
    audio_url: "https://tile.loc.gov/storage-services/fake.mp3"
    can_download: true
    rights: "No known restrictions on use."
    item_url: "https://www.loc.gov/item/jukebox-4649/"
    checked: "2026-10-07"
- song: steal-away
  loc_id: jukebox-5000
  status: approved
  delivery: stream
  note: null
  loc:
    title: "Steal away to Jesus"
    date: "1931-03-04"
    collection: "national jukebox"
    performers: ["Unnamed quartet"]
    place: null
    duration_seconds: 160
    audio_url: "https://tile.loc.gov/streaming-services/streamed.mp3"
    can_download: false
    rights: "Hosted by permission from the rightsholders."
    item_url: "https://www.loc.gov/item/jukebox-5000/"
    checked: "2026-10-07"
- song: steal-away
  loc_id: jukebox-6000
  status: rejected
  delivery: null
  note: "Instrumental only; no voices."
  loc: null
```

Note that `poor-rosy` deliberately has no entry at all, and `jukebox-6000` is
rejected. Both must be absent from the rendered page.

- [ ] **Step 4: Write the failing end-to-end test**

`tests/build-e2e.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let html = '';
let songsHtml = '';

beforeAll(() => {
  const out = mkdtempSync(join(tmpdir(), 'dubois-build-'));
  execFileSync('npx', ['astro', 'build', '--outDir', out], {
    env: { ...process.env, DUBOIS_DATA_DIR: 'tests/fixtures/site' },
    stdio: 'pipe',
  });
  html = readFileSync(join(out, 'chapter/1/index.html'), 'utf8');
  songsHtml = readFileSync(join(out, 'songs/index.html'), 'utf8');
}, 180_000);

describe('a built chapter page', () => {
  it('renders both songs on the chapter', () => {
    expect(html).toContain('Steal Away');
    expect(html).toContain('Poor Rosy');
  });

  it('points a self-hosted recording at a local path', () => {
    expect(html).toContain('src="/audio/steal-away--jukebox-4649.mp3"');
  });

  it('points a streamed recording at loc.gov', () => {
    expect(html).toContain('https://tile.loc.gov/streaming-services/streamed.mp3');
  });

  it('shows the teacher note', () => {
    expect(html).toContain('A note that must reach the page.');
  });

  it('links the Library of Congress item for citation', () => {
    expect(html).toContain('https://www.loc.gov/item/jukebox-4649/');
    expect(html).toContain('https://www.loc.gov/item/jukebox-5000/');
  });

  it('labels each player with the performer and the year', () => {
    expect(html).toMatch(/aria-label="[^"]*Fisk University Jubilee Quartet[^"]*1902[^"]*"/);
  });

  it('omits a rejected recording entirely', () => {
    expect(html).not.toContain('jukebox-6000');
    expect(html).not.toContain('Instrumental only');
  });

  it('says so for a song with no approved recording', () => {
    expect(html).toContain('No vetted recording');
  });

  it('marks the streamed one as coming from loc.gov', () => {
    expect(html).toContain('streamed from loc.gov');
  });

  it('ships the chapter prose, not just the players', () => {
    expect(html).toContain('Of Our Spiritual Strivings');
  });
});

describe('the built table of songs', () => {
  it('lists both fixture songs', () => {
    expect(songsHtml).toContain('Steal Away');
    expect(songsHtml).toContain('Poor Rosy');
  });

  it('shows none-yet for the song with no recording', () => {
    expect(songsHtml).toContain('none yet');
  });
});
```

- [ ] **Step 5: Run it to make sure it fails**

Run: `nix develop --command pnpm test -- build-e2e`
Expected: FAIL. If `DUBOIS_DATA_DIR` is not yet wired, the build renders the
real 18 songs and the `Poor Rosy`-on-chapter-1 assertions fail.

- [ ] **Step 6: Make it pass**

Complete Step 1 if it is not done. Then run:

Run: `nix develop --command pnpm test -- build-e2e`
Expected: PASS, 12 assertions.

If the `aria-label` assertion fails, read the real attribute out of the built
HTML and correct the regex. Do not weaken it to drop the performer or the year
— the spec requires both for citation.

- [ ] **Step 7: Run the whole suite**

Run: `nix develop --command pnpm test`
Expected: all PASS. The e2e test adds roughly 30 seconds.

- [ ] **Step 8: Commit**

```bash
git add src/content.config.ts tests/fixtures/site/ tests/build-e2e.test.ts
git commit -m "test: end-to-end build check from a fixture manifest"
```

---

### Task 14: Docker, fly.io, CI, and push-to-deploy

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `fly.toml`, `nginx.conf`, `.github/workflows/ci.yml`, `.github/workflows/fly-deploy.yml`, `scripts/check-links.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: a `dist/` produced by `pnpm build`.
- Produces: a running app at `https://dubois-outloud.fly.dev` and two GitHub Actions workflows.

- [ ] **Step 1: Write `nginx.conf`**

```nginx
server {
  listen 8080;
  root /usr/share/nginx/html;
  index index.html;

  # Astro emits directory-style routes, so /chapter/1/ must find
  # /chapter/1/index.html.
  location / {
    try_files $uri $uri/index.html $uri/ =404;
  }

  # Audio is immutable: a filename carries the song slug and the LoC item id,
  # so a changed recording is a changed filename.
  location /audio/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    add_header Accept-Ranges bytes;
  }

  gzip on;
  gzip_types text/html text/css application/javascript image/svg+xml;
  # Do not gzip audio; MP3 is already compressed.

  error_page 404 /404.html;
}
```

- [ ] **Step 2: Write the `Dockerfile`**

```dockerfile
# Build the static site, then serve it from nginx. Audio and cropped notation
# must already be present in the build context — CI fetches them before this
# runs. See .github/workflows/fly-deploy.yml.
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
```

- [ ] **Step 3: Write `.dockerignore`**

```
node_modules
dist
.astro
.direnv
.git
.github
docs
tests
.tmp
```

Note: `public/audio` and `src/assets/notation` are deliberately absent, so the
build context carries them.

- [ ] **Step 4: Write `fly.toml`**

```toml
app = 'dubois-outloud'
primary_region = 'ewr'

[build]

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  # A class should not pay a cold start in the middle of a lesson. One warm
  # machine costs about two dollars a month.
  min_machines_running = 1

[[vm]]
  memory = '256mb'
  cpu_kind = 'shared'
  cpus = 1
```

- [ ] **Step 5: Write `scripts/check-links.mjs`**

```js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* htmlFiles(path);
    else if (name.endsWith('.html')) yield path;
  }
}

function exists(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (clean === '' || clean === '/') return true;
  const base = join(DIST, clean);
  try {
    return statSync(base).isDirectory()
      ? statSync(join(base, 'index.html')).isFile()
      : statSync(base).isFile();
  } catch {
    return false;
  }
}

const broken = [];
for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    if (!exists(m[1])) broken.push(`${file} -> ${m[1]}`);
  }
}

if (broken.length > 0) {
  console.error(`${broken.length} broken internal links:`);
  for (const line of broken) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('No broken internal links.');
```

Add to `package.json` scripts:

```json
    "check:links": "node scripts/check-links.mjs",
```

- [ ] **Step 6: Run the link check locally**

Run:
```bash
nix develop --command pnpm build
nix develop --command pnpm check:links
```
Expected: `No broken internal links.`

If `/audio/...` paths report broken, the MP3s are missing from `public/`. Run
`pnpm fetch:audio` first.

- [ ] **Step 7: Write `.github/workflows/ci.yml`**

```yaml
# Typecheck, unit tests, and a full build that exercises the manifest schema.
# The build is the schema check: a bad recordings.yaml fails it by design.
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    name: typecheck + unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm test

  build:
    name: build + link check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      # Audio and notation are build artifacts, not source. Cache them on the
      # manifests that produce them, so loc.gov and archive.org see a request
      # only when a manifest actually changes.
      - name: Restore fetched assets
        uses: actions/cache@v4
        with:
          path: |
            public/audio
            src/assets/notation
          key: assets-${{ hashFiles('src/data/recordings.yaml', 'src/data/songs.yaml') }}

      - run: pnpm fetch:audio
      - run: pnpm fetch:scans
      - run: pnpm build
      - run: pnpm check:links
```

- [ ] **Step 8: Write `.github/workflows/fly-deploy.yml`**

```yaml
# See https://fly.io/docs/app-guides/continuous-deployment-with-github-actions/
# Follows the convention in ~/dev/tune_buddy.
name: Fly Deploy

on:
  push:
    branches:
      - main

jobs:
  deploy:
    name: Deploy app
    runs-on: ubuntu-latest
    concurrency: deploy-group
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      # The Docker build needs the audio and the notation in its context, and
      # neither is in git. Same cache key as CI, so a push that changes no
      # manifest reuses what CI already fetched.
      - name: Restore fetched assets
        uses: actions/cache@v4
        with:
          path: |
            public/audio
            src/assets/notation
          key: assets-${{ hashFiles('src/data/recordings.yaml', 'src/data/songs.yaml') }}

      - run: pnpm fetch:audio
      - run: pnpm fetch:scans

      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

- [ ] **Step 9: Create the GitHub repository**

Run:
```bash
nix develop --command gh repo create dubois-outloud --public \
  --description "The Souls of Black Folk with Library of Congress recordings of the sorrow songs" \
  --source . --remote origin
```

If `gh` is absent from the dev shell, add `pkgs.gh` to `flake.nix` and re-enter.

Then replace `OWNER` with the real owner in `scripts/lib/http.mjs` and
`src/pages/about.astro`:

```bash
OWNER=$(nix develop --command gh api user --jq .login)
sed -i "s|github.com/OWNER/dubois-outloud|github.com/$OWNER/dubois-outloud|g" \
  scripts/lib/http.mjs src/pages/about.astro
```

- [ ] **Step 10: Create the fly app**

Run:
```bash
nix develop --command flyctl apps create dubois-outloud
```
Expected: `New app created: dubois-outloud`.

If the name is taken, pick `dubois-out-loud`, and change `app` in `fly.toml`
and the `site` URL in `astro.config.mjs` to match.

- [ ] **Step 11: Create the deploy token and set the secret**

Run:
```bash
nix develop --command flyctl tokens create deploy -a dubois-outloud \
  | tail -1 \
  | nix develop --command gh secret set FLY_API_TOKEN --app actions
```
Expected: `✓ Set Actions secret FLY_API_TOKEN`.

Do not echo the token. Do not commit it.

- [ ] **Step 12: Deploy once by hand before trusting CI**

Run:
```bash
nix develop --command flyctl deploy --remote-only
```
Expected: the build succeeds and the machine starts.

Then check it:
```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://dubois-outloud.fly.dev/
curl -sS -o /dev/null -w '%{http_code}\n' https://dubois-outloud.fly.dev/chapter/1/
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://dubois-outloud.fly.dev/audio/nobody-knows-the-trouble-ive-seen--jukebox-879940.mp3
```
Expected: `200`, `200`, and `200 audio/mpeg`.

- [ ] **Step 13: Commit and push, then confirm CI deploys**

```bash
git add Dockerfile .dockerignore fly.toml nginx.conf \
        .github/workflows/ci.yml .github/workflows/fly-deploy.yml \
        scripts/check-links.mjs scripts/lib/http.mjs \
        src/pages/about.astro package.json
git commit -m "feat: nginx image, fly config, CI and push-to-deploy"
git push -u origin main
```

Then watch both workflows:
```bash
nix develop --command gh run watch
```
Expected: CI passes and Fly Deploy succeeds.

- [ ] **Step 14: Prove the build fails on a broken recording**

This is the spec's load-bearing promise, so check it rather than assume it.

```bash
# Break one approved entry's audio_url, then build.
sed -i '0,/audio_url:/{s|audio_url: .*|audio_url: null|}' src/data/recordings.yaml
nix develop --command pnpm build; echo "exit=$?"
git checkout src/data/recordings.yaml
```
Expected: the build fails with a message naming the `loc_id` and `audio_url`,
and `exit=1`.

- [ ] **Step 15: Write `README.md` for the person who inherits this**

```markdown
# Du Bois Out Loud

*The Souls of Black Folk* (1903) with Library of Congress recordings of the
sorrow song at each chapter head. Built for a high school classroom.

Live at <https://dubois-outloud.fly.dev>.

## Working on it

Everything runs inside the Nix dev shell.

    nix develop
    pnpm install
    pnpm dev

## Adding or changing a recording

`src/data/recordings.yaml` is the only file you need to edit. You own three
fields on each entry; scripts own the `loc:` block and never touch yours.

    status:   unreviewed | approved | rejected
    delivery: selfhost | stream
    note:     what a student should listen for

To find new candidates:

    pnpm find:recordings    # searches loc.gov, appends unreviewed entries
    pnpm fetch:loc          # fills in metadata and proposes a delivery mode

Then set `status` on the ones you want, and:

    pnpm fetch:audio        # downloads the approved self-hosted ones
    pnpm build              # fails if anything approved is broken

Push to `main` and it deploys.

## Why a recording streams instead of being served from here

Library of Congress items carry different rights. Folklife Center field
recordings say no known restrictions, so we host a copy. National Jukebox items
are hosted by permission from Sony and EMI, so only pre-1923 sides are copied,
on Music Modernization Act grounds; later ones stream from loc.gov. The rule is
in `scripts/lib/rights.mjs` and every decision's rights statement is stored
beside it in the manifest.

## Design and plan

- `docs/superpowers/specs/2026-10-07-dubois-outloud-design.md`
- `docs/superpowers/plans/2026-10-07-dubois-outloud.md`
```

- [ ] **Step 16: Commit**

```bash
git add README.md
git commit -m "docs: README for maintaining the recordings manifest"
git push
```

---

## Remaining human work after Task 14

The tooling is complete at Task 14, but the site is not finished. These steps
are curation, not code, and the spec calls them out as human work:

1. Vet the candidates `find-recordings.mjs` proposed. Set `status` and write a
   `note` on the ones worth a student's time.
2. Find the page index and crop box for each of the 14 epigraphs (Task 10,
   Steps 2 and 3) if they were left at a first approximation.
3. Accept that some songs will have no usable recording. *Do Bana Coba* is the
   likeliest. The chapter page already handles this.
