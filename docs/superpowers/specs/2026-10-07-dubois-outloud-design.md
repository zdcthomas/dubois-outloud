# Du Bois Out Loud — Design

A static site that presents W. E. B. Du Bois, *The Souls of Black Folk* (1903),
with the sorrow song at each chapter head paired to real recordings from the
Library of Congress.

- **Date:** 2026-10-07
- **Status:** approved design, ready for an implementation plan

## 1. Intent

**Who it is for.** A high school teacher, and that teacher's students.

**What it must do.** A student opens a chapter, reads the verse Du Bois placed
at its head, sees the bar of notation he printed with it, and hears the
spiritual performed. A student can compare two or three performances of the
same spiritual against each other.

**What success looks like.**

- Every chapter that Du Bois gave a song gets at least one working recording.
- A chapter has its own URL, so the teacher can assign one.
- A student can cite any recording: performer, year, place, and a link to the
  Library of Congress item.
- The site loads on a school Chromebook over school wifi.
- The teacher can review, add, and remove recordings by editing one text file.

**Explicit non-goals.** No user accounts. No annotation or note-taking. No
search. No backend of any kind.

## 2. What already exists, and what we take from it

`way.net/SoulsOfBlackFolk/` is a 1998 HoTMetaL frameset edition. Chapters live
at `00.html` through `15.html`. Each chapter shows a sheet-music GIF that links
to a per-song page. The only audio on the site is two MIDI files,
`12SwingLow.mid` and `13HearTheTrumpet.mid`. The markup also carries injected
pharmaceutical spam.

**We take one thing from that site: the structural fact of which spiritual
belongs to which chapter.** That pairing is a fact about the 1903 book, not an
expressive work.

**We do not copy its files, its markup, or its editorial commentary.** The
commentary is modern scholarship and is under copyright.

## 3. Sources and rights

| Asset | Source | Status |
|---|---|---|
| Book text | Project Gutenberg, 1903 edition | Public domain |
| Epigraph notation | Internet Archive scan `cu31924024920492` | Public domain |
| Recordings | loc.gov JSON API | Per item, see below |
| Teacher notes | Written by us | Ours |

### 3.1 The recording rights rule

The loc.gov JSON API returns a `rights` statement per item and a `canDownload`
flag per resource. Two collections matter here and they differ.

**American Folklife Center field recordings** (for example `lomaxbib000533`)
carry a statement that the Library knows of no U.S. copyright protection or
other restrictions. These are clean to self-host. Note that an AFC item can
still expose one resource with `canDownload: false` alongside another with
`canDownload: true`. Respect the flag per resource.

**National Jukebox** items (for example `jukebox-879940`, `jukebox-128141`)
carry a statement that the Library hosts them by permission from the
rightsholders, courtesy of Sony Music Entertainment or EMI. That is not a
redistribution licence. The Library's own statement also notes that the Music
Modernization Act moves these recordings into the public domain over time.

**The rule the scripts apply:**

1. Rights statement says no known restrictions → propose `delivery: selfhost`.
2. National Jukebox and item date is before 1923 → propose `delivery: selfhost`,
   on the Music Modernization Act.
3. Otherwise → propose `delivery: stream`, pointing at the loc.gov URL.
4. Any resource with `canDownload: false` is never a download candidate.

The script **proposes**. It writes a `delivery` value only when the field is
absent, and never changes one a human set. The verbatim rights statement and
the item date are stored next to the decision, so the teacher can defend any
choice without re-deriving it.

This is an engineering rule, not legal advice.

## 4. Data model

Two YAML files under `src/data/`, split by how often they change and by who
edits them.

### 4.1 `songs.yaml` — settled structure

Written once. One entry per spiritual Du Bois placed at a chapter head.

```yaml
- slug: nobody-knows
  chapter: 1
  title: "Nobody Knows the Trouble I've Seen"
  scan:
    ia_item: cu31924024920492
    page: 11
    crop: [120, 340, 980, 460]   # left, top, right, bottom
```

The chapter-to-song pairing, taken from the 1903 book:

| Chapter | Spiritual |
|---|---|
| 1 | Nobody Knows the Trouble I've Seen |
| 2 | My Lord, What a Mourning |
| 3 | A Great Camp-meeting in the Promised Land |
| 4 | My Way's Cloudy |
| 5 | The Rocks and the Mountains |
| 6 | March On |
| 7 | Bright Sparkles in the Churchyard |
| 8 | Children, You'll Be Called On |
| 9 | I'm a Rolling |
| 10 | Steal Away |
| 11 | I Hope My Mother Will Be There |
| 12 | Swing Low, Sweet Chariot |
| 13 | I'll Hear the Trumpet Sound |
| 14 | Wrestlin' Jacob |

Chapter 14 also discusses *Do Bana Coba*, *My Soul Wants Something That's New*,
*Poor Rosy*, and *Weary Traveller*. Each gets its own `songs.yaml` entry with
`chapter: 14`. The Forethought and the Afterthought carry no song and get no
entry. A flat list with a `chapter` field handles all three cases without a
special case.

### 4.2 `recordings.yaml` — the vetting file

This is the file the teacher and the maintainer work in.

```yaml
- song: nobody-knows
  loc_id: jukebox-879940

  # --- a human owns these three ---
  status: approved        # unreviewed | approved | rejected
  delivery: selfhost      # selfhost | stream
  note: "Fisk University Jubilee Quartet. Compare the studio harmony here
         against the Clemson congregation in chapter 2."

  # --- scripts/fetch-loc.mjs owns this block; do not hand-edit ---
  loc:
    title: "Nobody knows de trouble I've seen"
    date: "1917-11-21"
    collection: "National Jukebox"
    performers: ["Fisk University Jubilee Quartet"]
    place: null
    duration_seconds: 186
    audio_url: "https://tile.loc.gov/storage-services/..."
    can_download: true
    rights: "The Library makes the sound recordings in the National Jukebox…"
    item_url: "https://www.loc.gov/item/jukebox-879940/"
    checked: "2026-10-07"
```

**Why two files.** `songs.yaml` is settled and `recordings.yaml` churns. In one
file, a human would hunt for their own three lines among thirty a script wrote.

**Why the `loc:` block is fenced off.** Re-running the fetch script must
refresh metadata without destroying vetting decisions. The script rewrites only
`loc:`.

**Why `status` and `delivery` are separate.** Approving a recording and deciding
how to serve it are different judgments. A recording can be approved and
streamed because its rights are unclear.

**Why rejected entries stay.** They record what a human already considered. The
build skips them.

### 4.3 Schema validation

An Astro content collection validates both files with a Zod schema at build
time. The schema enforces:

- `status` and `delivery` are one of their allowed values.
- `song` matches a `slug` in `songs.yaml`.
- An approved entry has a non-empty `loc.audio_url`.
- An entry with `delivery: selfhost` has `loc.can_download: true`.
- `chapter` is an integer from 1 to 14.

A build fails on a bad manifest and names the offending entry. It never renders
a silently broken chapter.

The build also prints a count of `unreviewed` entries, so pending work stays
visible.

## 5. Site structure

```
/                    title page, the Forethought, chapter list
/chapter/1/ … /14/   one page per chapter
/afterthought/       the Afterthought
/songs/              table of every song and every approved recording
/about/              sources, citations, rights, how it was built
```

A chapter page carries, in order:

1. The epigraph verse.
2. The cropped bar of notation, with a caption naming the scan it came from.
3. The recordings block.
4. The chapter text.

The recordings block lists each approved recording with its performer, year,
place when the record names one, the teacher's note, a native `<audio>`
element, and a link to the loc.gov item page.

`/about/` names Project Gutenberg, the Internet Archive scan, every LoC item,
and the rights statement each recording carries. This is the page a district
librarian reads.

### 5.1 Client JavaScript

One script, roughly 25 lines: when a student starts one `<audio>` element,
pause the others. Nothing else. No `preload`. No framework ships to the
browser.

### 5.2 Accessibility

- The notation image gets alt text naming the song and that the image shows a
  bar of music, because the notation carries no words in the original.
- Each `<audio>` element gets a label naming the performer and the year.
- Text meets WCAG AA contrast in both light and dark colour schemes.
- Every chapter is reachable by keyboard from the chapter list.

## 6. Build pipeline

Five Node scripts in `scripts/`, each with one job.

| Script | Reads | Writes |
|---|---|---|
| `fetch-text.mjs` | Project Gutenberg | `src/content/chapters/*.md` |
| `find-recordings.mjs` | `songs.yaml`, loc.gov search API | appends `status: unreviewed` entries to `recordings.yaml` |
| `fetch-loc.mjs` | `recordings.yaml` | refreshes every `loc:` block |
| `fetch-audio.mjs` | `recordings.yaml` | `public/audio/*.mp3` |
| `crop-scans.mjs` | `songs.yaml`, Internet Archive | `src/assets/notation/*.png` |

`find-recordings.mjs` is the discovery pass. `fetch-loc.mjs` is the refresh
pass. They are separate so that re-checking metadata and dead audio URLs on
approved recordings does not drop new candidates into the same diff.

All five scripts are idempotent and safe to re-run.

### 6.1 Source versus artifact

`recordings.yaml`, `songs.yaml`, and the fetched chapter Markdown are source
and live in git.

`public/audio/*.mp3` and `src/assets/notation/*.png` are build artifacts. They
are gitignored and regenerated from the manifest. This keeps the repository
small and every build reproducible.

### 6.2 The audio-in-CI problem

Because audio is not in git, a CI runner has no MP3s when it builds the image.

**The fix:** `actions/cache`, keyed on a hash of `recordings.yaml`. The runner
downloads from loc.gov only when the manifest changes, and reuses the cache
otherwise. This avoids hitting the Library on every push.

**The accepted cost:** the deploy uploads roughly 100–150 MB of build context
to the fly builder on each push, adding a minute or two.

### 6.3 Politeness to loc.gov

Every script sends a descriptive `User-Agent` with a contact address, requests
serially rather than in parallel, and sleeps briefly between requests. A failed
request retries three times with backoff, then records the failure in the
manifest rather than aborting the run.

## 7. Toolchain

| Concern | Choice |
|---|---|
| Generator | Astro, pinned, zero client JS by default |
| Package manager | pnpm, lockfile committed |
| Image work | `sharp` |
| Scripts | Node 22, ESM, in `scripts/` |
| Environment | Nix flake |
| Host | fly.io, nginx serving `dist/` |

**Why Astro over Eleventy.** Content collections validate a hand-edited data
file against a schema at build time. The manifest is the file a human edits, so
a clear build error there is the single most useful thing a framework gives this
project.

**Why not Python, which suits the API and image work.** Node does both jobs
here, `sharp` arrives with Astro anyway, and one toolchain is less to own than
two.

**Longevity.** The teacher may keep this long after the maintainer stops
touching it. Three things contain framework churn: versions are pinned and the
lockfiles are committed; the output is plain static HTML that keeps working if
the toolchain rots; and the real source, the text and the manifest, stays as
plain files any generator can consume.

### 7.1 Nix flake

Follows the shape of `~/dev/name_that_tune/flake.nix`: `flake-utils`,
`eachDefaultSystem`, one `devShells.default`. Packages: `nodejs_22`, `pnpm`,
`flyctl`, and `vips` for `sharp`. `flake.lock` pins nixpkgs, so the build does
not drift.

## 8. Deployment

**App:** `dubois-outloud` on fly.io, at `dubois-outloud.fly.dev`.

**Repository:** a new public repo under the user's GitHub account.

`fly.toml` serves `dist/` from nginx. One 256 MB shared-CPU machine with
`min_machines_running = 1`. A static site could scale to zero, but a class
should not pay a cold start in the middle of a lesson. That costs about two
dollars a month.

### 8.1 Continuous deployment

Follows the existing convention in `~/dev/tune_buddy/.github/workflows/fly-deploy.yml`:
push to `main`, `superfly/flyctl-actions/setup-flyctl`, then
`flyctl deploy --remote-only` with `FLY_API_TOKEN` from repository secrets.

The deploy token is scoped to this one app, created with
`flyctl tokens create deploy -a dubois-outloud`.

### 8.2 Continuous integration

A separate workflow runs on pull requests and on `main`:

- `astro check` for types.
- The manifest schema validation, by running a build.
- A link check over `dist/`, which catches a dead `loc.gov` item URL.

CI is a separate job from deploy so that a bad manifest reports as a bad
manifest.

## 9. Error handling

| Failure | Behaviour |
|---|---|
| Bad `recordings.yaml` | Build fails, naming the entry and the field. |
| Approved recording, dead audio URL | Build fails. A silent gap in a lesson is worse than a failed deploy. |
| `unreviewed` entries present | Build succeeds, prints a count. |
| A song has no approved recording | Chapter renders with verse, notation, and text. A short line says no vetted recording exists yet. |
| loc.gov unreachable during a fetch script | Retry three times, then leave the existing `loc:` block untouched and report which entries went unchecked. |
| `delivery: stream` and loc.gov is blocked at the school | The player shows the browser's native error. The item link still works. Documented in `/about/`. |

## 10. Testing

The risk in this project is data, not logic. Tests go where the data is.

**Unit tests** cover the pure functions: the rights rule that proposes a
`delivery` value, the loc.gov JSON parser that extracts an audio URL, and the
Gutenberg chapter splitter. Each gets table-driven cases built from saved API
responses, including the three known items and at least one item with
`canDownload: false`.

**Fixture tests** run against saved loc.gov JSON in `tests/fixtures/`, captured
from real responses. No test calls the network.

**Schema tests** assert that a manifest with each specific defect fails
validation with a message naming the entry.

**One end-to-end check** builds the site from a two-song fixture manifest and
asserts that a chapter page contains the expected `<audio>` sources, the
notation image, and the item links.

The scripts that only move bytes — `fetch-audio.mjs`, `crop-scans.mjs` — get no
unit tests. Their correctness shows up in the build.

## 11. Build sequence

1. Nix flake, `package.json`, Astro skeleton, `.gitignore`. Empty site builds.
2. `songs.yaml` with all eighteen entries. Schema and its tests.
3. `fetch-text.mjs` and the chapter content collection. Chapters render text.
4. `crop-scans.mjs`. Notation appears on each chapter.
5. `fetch-loc.mjs`, the rights rule, and their tests. Manifest round-trips.
6. `fetch-audio.mjs` and the recordings block. Players work locally.
7. `find-recordings.mjs`. The discovery pass fills the manifest with candidates.
8. Vet the candidates. This step is human work, not code.
9. `/songs/` and `/about/`.
10. `fly.toml`, Dockerfile, CI workflow, deploy workflow. First deploy.

Steps 1 through 7 need no vetting decisions, so the tooling can land before the
curation starts.

## 12. Open items the maintainer must resolve during the build

- The page index of each epigraph within scan `cu31924024920492`. The scan holds
  288 page images. `crop-scans.mjs` pulls a single page through the Internet
  Archive IIIF endpoint rather than downloading the whole JP2 bundle. Step 4
  resolves the indices and the crop boxes by inspection.
- Whether loc.gov holds a usable recording for every one of the eighteen songs.
  Some are likely to have none. Section 9 defines what the page does in that
  case.
