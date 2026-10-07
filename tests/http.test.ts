import { describe, expect, it } from 'vitest';
import { retryDelay } from '../scripts/lib/http.mjs';

const res = (status: number, headers: Record<string, string> = {}) =>
  ({ status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as Response;

describe('retryDelay', () => {
  it('honours Retry-After in seconds, which is what loc.gov sends on a 429', () => {
    expect(retryDelay(res(429, { 'retry-after': '30' }), 1)).toBe(30_000);
  });

  it('prefers Retry-After over its own backoff even when the header is large', () => {
    expect(retryDelay(res(429, { 'retry-after': '120' }), 1)).toBe(120_000);
  });

  it('ignores a nonsense Retry-After and falls back to backoff', () => {
    expect(retryDelay(res(429, { 'retry-after': 'soon' }), 1)).toBeGreaterThan(0);
  });

  it('backs off exponentially when no header is given', () => {
    const a = retryDelay(res(503), 1);
    const b = retryDelay(res(503), 2);
    const c = retryDelay(res(503), 3);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('waits at least a second before retrying a 429', () => {
    // A retry that fires immediately just burns another request against the
    // limit that rejected us.
    expect(retryDelay(res(429), 1)).toBeGreaterThanOrEqual(1000);
  });

  it('caps the wait so one bad header cannot stall a run for an hour', () => {
    expect(retryDelay(res(429, { 'retry-after': '99999' }), 1)).toBeLessThanOrEqual(120_000);
  });
});
