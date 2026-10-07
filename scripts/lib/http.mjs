const UA =
  'dubois-outloud/1.0 (+https://github.com/OWNER/dubois-outloud; zach.thomas@hey.com)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/**
 * Returns the body alongside the Content-Length the server declared, so the
 * caller can tell a complete download from a truncated one. A silent partial
 * MP3 is the failure the design forbids outright.
 */
export async function fetchBinary(url) {
  const res = await request(url);
  await sleep(250);
  const buf = Buffer.from(await res.arrayBuffer());
  const declared = res.headers.get('content-length');
  return { buf, declared: declared === null ? null : Number(declared) };
}
