import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The only test that builds the whole site. Everything else is a unit test, so
 * this is the one that proves the pieces fit: manifest -> collection ->
 * component -> rendered HTML.
 *
 * DUBOIS_DATA_DIR points the build at a fixture directory. The alternative —
 * copying fixtures over src/data and restoring afterwards — eats a
 * maintainer's work in progress if the test crashes partway through.
 */
let chapter = '';
let songsPage = '';

beforeAll(() => {
  const out = mkdtempSync(join(tmpdir(), 'dubois-build-'));
  execFileSync('npx', ['astro', 'build', '--outDir', out], {
    env: { ...process.env, DUBOIS_DATA_DIR: 'tests/fixtures/site' },
    stdio: 'pipe',
  });
  chapter = readFileSync(join(out, 'chapter/1/index.html'), 'utf8');
  songsPage = readFileSync(join(out, 'songs/index.html'), 'utf8');
}, 180_000);

describe('a built chapter page', () => {
  it('renders both songs on the chapter', () => {
    expect(chapter).toContain('Steal Away');
    expect(chapter).toContain('Poor Rosy');
  });

  it('points a self-hosted recording at a local path', () => {
    expect(chapter).toContain('src="/audio/steal-away--jukebox-4649.mp3"');
  });

  it('points a streamed recording at loc.gov', () => {
    expect(chapter).toContain('https://tile.loc.gov/streaming-services/streamed.mp3');
  });

  it('shows the teacher note', () => {
    expect(chapter).toContain('A note that must reach the page.');
  });

  it('links the Library of Congress item for citation', () => {
    expect(chapter).toContain('https://www.loc.gov/item/jukebox-4649/');
    expect(chapter).toContain('https://www.loc.gov/item/jukebox-5000/');
  });

  it('labels each player with the performer and the year', () => {
    expect(chapter).toMatch(
      /aria-label="[^"]*Fisk University Jubilee Quartet[^"]*1902[^"]*"/,
    );
  });

  it('omits a rejected recording entirely', () => {
    expect(chapter).not.toContain('jukebox-6000');
    expect(chapter).not.toContain('Instrumental only');
  });

  it('says so for a song with no approved recording', () => {
    expect(chapter).toContain('No vetted recording');
  });

  it('marks the streamed one as coming from loc.gov', () => {
    expect(chapter).toContain('streamed from loc.gov');
  });

  it('ships the chapter prose, not just the players', () => {
    expect(chapter).toContain('Of Our Spiritual Strivings');
  });

  it('never emits a player with an empty or undefined source', () => {
    expect(chapter).not.toMatch(/src="(?:|undefined|null)"/);
  });
});

describe('the built table of songs', () => {
  it('lists both fixture songs', () => {
    expect(songsPage).toContain('Steal Away');
    expect(songsPage).toContain('Poor Rosy');
  });

  it('shows none-yet for the song with no recording', () => {
    expect(songsPage).toContain('none yet');
  });
});
