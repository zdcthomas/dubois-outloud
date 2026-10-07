const UA =
  'dubois-outloud/1.0 (+https://github.com/OWNER/dubois-outloud; zach.thomas@hey.com)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * How long to wait before retrying.
 *
 * loc.gov answers 429 with a Retry-After, and ignoring it is what made a
 * 150-item refresh give up on 43 of them: the old backoff retried after one
 * and two seconds, well inside the window the Library had just asked us to
 * wait out. Honour the header when it is sane, back off exponentially when it
 * is not, and cap it so one absurd header cannot stall a run for an hour.
 */
export function retryDelay(res, attempt) {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) {
    return Math.min(header * 1000, MAX_RETRY_MS);
  }
  return Math.min(1000 * 2 ** attempt, MAX_RETRY_MS);
}

const MAX_RETRY_MS = 120_000;

/**
 * Pause between requests. loc.gov throttles well below what 250ms implies
 * (240/min), so the default is deliberately slow — these are curation scripts
 * a person runs occasionally, not anything in the build's hot path.
 * Override with DUBOIS_REQUEST_GAP_MS when working against a fixture.
 */
const GAP_MS = Number(process.env.DUBOIS_REQUEST_GAP_MS ?? 3000);

/**
 * Serial, polite, retrying fetch. Every caller in this project shares it so
 * that no code path can accidentally hammer loc.gov or archive.org in
 * parallel. The OWNER placeholder is resolved once the repository exists.
 *
 * Retries only 429 and 5xx: a 404 means the item moved or was withdrawn, and
 * asking three more times will not change that.
 */
async function request(url, init = {}, attempt = 1) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
  });
  if (res.ok) return res;
  const retryable = res.status === 429 || res.status >= 500;
  if (retryable && attempt < 5) {
    await sleep(retryDelay(res, attempt));
    return request(url, init, attempt + 1);
  }
  throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
}

export async function fetchText(url) {
  const res = await request(url);
  await sleep(GAP_MS);
  return res.text();
}

export async function fetchJson(url) {
  const res = await request(url);
  await sleep(GAP_MS);
  return res.json();
}

/**
 * Returns the body alongside the Content-Length the server declared, so the
 * caller can tell a complete download from a truncated one. A silent partial
 * MP3 is the failure the design forbids outright.
 */
export async function fetchBinary(url) {
  const res = await request(url);
  await sleep(GAP_MS);
  const buf = Buffer.from(await res.arrayBuffer());
  const declared = res.headers.get('content-length');
  return { buf, declared: declared === null ? null : Number(declared) };
}
