import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkManifests } from '../src/manifest-gate.ts';

/**
 * Two levels, deliberately.
 *
 * checkManifests() tests the rule. The build tests the WIRING — that the gate
 * sits somewhere Astro will not swallow. That distinction is the whole point
 * of this file: the gate first lived in the content collection's loader
 * parser, every unit test passed, and a build with a broken manifest still
 * exited 0, because file() catches parser errors and carries on. Only a real
 * build can catch that regression.
 */

function buildWith(dataDir: string): { status: number; output: string } {
  const out = mkdtempSync(join(tmpdir(), 'dubois-gate-'));
  try {
    const output = execFileSync('npx', ['astro', 'build', '--outDir', out], {
      env: { ...process.env, DUBOIS_DATA_DIR: dataDir },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, output };
  } catch (err: any) {
    return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('checkManifests', () => {
  it('passes a clean manifest and counts what awaits review', () => {
    const result = checkManifests('tests/fixtures/manifest-ok');
    expect(result.total).toBe(1);
    expect(result.unreviewed).toBe(1);
  });

  it('throws on an orphan song slug, naming the slug', () => {
    expect(() => checkManifests('tests/fixtures/manifest-broken')).toThrow(/no-such-song/);
  });

  it('throws on an orphan song slug, naming the loc_id', () => {
    expect(() => checkManifests('tests/fixtures/manifest-broken')).toThrow(/jukebox-4649/);
  });
});

describe('the gate is wired where a build cannot ignore it', () => {
  it('builds a clean fixture manifest successfully', () => {
    const { status } = buildWith('tests/fixtures/manifest-ok');
    expect(status).toBe(0);
  }, 180_000);

  it('FAILS the build on a broken manifest, rather than warning', () => {
    const { status, output } = buildWith('tests/fixtures/manifest-broken');
    expect(status).not.toBe(0);
    expect(output).toMatch(/no-such-song/);
  }, 180_000);

  it('does not emit pages when it refuses a manifest', () => {
    const { output } = buildWith('tests/fixtures/manifest-broken');
    expect(output).not.toMatch(/page\(s\) built/);
  }, 180_000);
});
