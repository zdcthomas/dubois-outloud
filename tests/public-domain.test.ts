import { describe, expect, it } from 'vitest';
import { isPublicDomain } from '../scripts/lib/rights.mjs';

// The Music Modernization Act's schedule for sound recordings, as the Library
// of Congress states it: everything before 1923 went public domain on
// 1 Jan 2022; 1923-1946 gets 100 years; 1947-1956 gets 110; and the rest stay
// protected until 15 Feb 2067.
describe('isPublicDomain', () => {
  it('releases everything published before 1923', () => {
    expect(isPublicDomain(1909, 2026)).toBe(true);
    expect(isPublicDomain(1917, 2026)).toBe(true);
    expect(isPublicDomain(1922, 2026)).toBe(true);
  });

  it('applies the rolling 100-year term to 1923-1946', () => {
    // A 1923 recording's term runs through 1 Jan 2024.
    expect(isPublicDomain(1923, 2023)).toBe(false);
    expect(isPublicDomain(1923, 2024)).toBe(true);
    // 1924 cleared on 1 Jan 2025 — this is the Marian Anderson case.
    expect(isPublicDomain(1924, 2024)).toBe(false);
    expect(isPublicDomain(1924, 2025)).toBe(true);
    expect(isPublicDomain(1925, 2026)).toBe(true);
  });

  it('has not yet released 1926, which clears on 1 Jan 2027', () => {
    expect(isPublicDomain(1926, 2026)).toBe(false);
    expect(isPublicDomain(1926, 2027)).toBe(true);
  });

  it('keeps 1946 protected until 2047', () => {
    expect(isPublicDomain(1946, 2026)).toBe(false);
    expect(isPublicDomain(1946, 2047)).toBe(true);
  });

  it('applies 110 years to 1947-1956', () => {
    expect(isPublicDomain(1947, 2026)).toBe(false);
    expect(isPublicDomain(1947, 2058)).toBe(true);
    expect(isPublicDomain(1956, 2066)).toBe(false);
    expect(isPublicDomain(1956, 2067)).toBe(true);
  });

  it('holds everything from 1957 onward until 2067', () => {
    expect(isPublicDomain(1957, 2066)).toBe(false);
    expect(isPublicDomain(1971, 2066)).toBe(false);
    expect(isPublicDomain(1957, 2068)).toBe(true);
  });

  it('treats a modern recording as protected', () => {
    expect(isPublicDomain(1990, 2026)).toBe(false);
    expect(isPublicDomain(2017, 2026)).toBe(false);
  });

  it('says no when the year is unknown, rather than guessing', () => {
    expect(isPublicDomain(null, 2026)).toBe(false);
  });
});
