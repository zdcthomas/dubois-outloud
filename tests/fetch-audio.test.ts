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

  it('is stable, so a rebuild does not invalidate the immutable cache header', () => {
    const entry = { song: 'steal-away', loc_id: 'jukebox-4649' };
    expect(audioFilename(entry)).toBe(audioFilename(entry));
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

  it('reports both the received and the declared size', () => {
    // The person reading a failed build needs to know how short it was.
    expect(() => checkDownload(Buffer.alloc(2000, 1), 5000, url)).toThrow(/2000/);
    expect(() => checkDownload(Buffer.alloc(2000, 1), 5000, url)).toThrow(/5000/);
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

  it('accepts a body longer than declared, which is not a truncation', () => {
    expect(() => checkDownload(Buffer.alloc(6000, 1), 5000, url)).not.toThrow();
  });
});
