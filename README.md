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
fields on each entry; the scripts own the `loc:` block and never touch yours.

    status:   unreviewed | approved | rejected
    delivery: selfhost | stream
    note:     what a student should listen for

To find new candidates:

    pnpm find:recordings    # searches loc.gov, appends unreviewed entries
    pnpm fetch:loc          # fills in metadata, proposes a delivery mode

Set `status` on the ones worth keeping, then:

    pnpm fetch:audio        # downloads the approved self-hosted ones
    pnpm build              # fails if anything approved is broken

Push to `main` and it deploys.

## Adding the notation for a chapter

Thirteen chapters still have `scan: null` in `src/data/songs.yaml`. To fill one
in, print a page and read the staff's bounds off it:

    node scripts/crop-scans.mjs --probe cu31924024920492 16

That writes `.probe/cu31924024920492-16.png`. Pages are 1272x2079 and `page` is
a 0-based leaf index, not the printed page number. Chapter 1 is page 16, and
the rest run roughly twenty pages apart. Put the page and the crop box into
`songs.yaml`, then `pnpm fetch:scans`.

Use `node scripts/crop-scans.mjs`, not `pnpm fetch:scans --`: pnpm eats the
flag.

## Why a recording streams instead of being served from here

Library of Congress items carry different rights. American Folklife Center
field recordings say no known restrictions, so we host a copy. National
Jukebox items are hosted by permission from Sony and EMI, so a side is copied
only once its Music Modernization Act term has run out; the rest stream from
loc.gov. That term is a moving target, not a fixed year — pre-1923 recordings
cleared in 2022, and 1923-1946 ones clear 100 years after publication, so every
January releases another twelve months. `isPublicDomain` in
`scripts/lib/rights.mjs` computes it; never hardcode a cutoff year anywhere
else, which is how the vetting page ended up warning about recordings that were
already public domain. The rule only ever *proposes*, and
the rights statement behind every decision is stored beside it in the manifest
and printed on `/about/`.

## Two things that will bite you

The manifest gate lives in `src/manifest-gate.ts` and runs as an Astro
integration, not in the content collection's loader. Astro's `file()` loader
swallows whatever its parser throws and finishes the build with exit 0, so a
gate there cannot fail a build. `tests/manifest-gate.test.ts` runs a real build
to prove the gate still bites.

Audio and cropped notation are build artifacts, not source. They are gitignored
and regenerated from the manifests, which is why CI fetches them before
building and caches them on a hash of the two YAML files.

## Design and plan

- `docs/superpowers/specs/2026-10-07-dubois-outloud-design.md`
- `docs/superpowers/plans/2026-10-07-dubois-outloud.md`
