import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { readManifest, writeManifest } from './lib/manifest.mjs';
import { isPublicDomain } from './lib/rights.mjs';

/**
 * A local-only page for approving or rejecting candidate recordings.
 *
 * Runs on 127.0.0.1 and writes straight to recordings.yaml through the same
 * helpers the other scripts use, so the file round-trips identically. It is
 * never deployed and never part of the built site — the published site stays
 * static with no backend.
 *
 *   pnpm vet            then open http://127.0.0.1:4321
 */
const DATA_DIR = process.env.DUBOIS_DATA_DIR ?? 'src/data';
const MANIFEST = `${DATA_DIR}/recordings.yaml`;
const PORT = Number(process.env.VET_PORT ?? 4321);

const STATUSES = ['unreviewed', 'approved', 'rejected'];

/**
 * Set one entry's status and note, leaving every other entry byte-identical.
 * Returns a new array; throws rather than silently doing nothing if the id is
 * unknown, because a no-op write would look like a successful decision.
 */
export function applyDecision(entries, locId, status, note) {
  if (!STATUSES.includes(status)) {
    throw new Error(`"${status}" is not one of ${STATUSES.join(', ')}`);
  }
  if (!entries.some((e) => e.loc_id === locId)) {
    throw new Error(`no entry with loc_id "${locId}"`);
  }
  return entries.map((e) =>
    e.loc_id === locId
      ? { ...e, status, note: note && note.trim() ? note.trim() : e.note }
      : e,
  );
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const mmss = (s) =>
  s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * A National Jukebox side still inside its copyright term is hosted by the
 * Library under permission from Sony and EMI, not public domain. Approving one
 * for self-hosting is the one route from vetting to a real rights problem, so
 * it is called out here, where the decision is actually made.
 *
 * The term comes from isPublicDomain rather than a number written here. This
 * function used to carry its own `year >= 1923` test and drifted out of step
 * the moment the real rule learned that 1923-1946 is a rolling 100-year term:
 * it was warning about recordings that had already entered the public domain.
 */
export function rightsWarning(loc) {
  if (!loc) return null;
  const jukebox = [...(loc.collections ?? []), loc.collection ?? '']
    .some((n) => /national jukebox/i.test(n));
  if (!jukebox) return null;

  const year = Number(String(loc.date ?? '').slice(0, 4));
  if (isPublicDomain(year)) return null;

  return `National Jukebox, ${Number.isFinite(year) ? year : 'date unknown'} — ` +
    `still in copyright, so NOT public domain. Stream it; do not self-host.`;
}

function page(entries, songTitles, filter) {
  const bySong = new Map();
  for (const e of entries) bySong.set(e.song, [...(bySong.get(e.song) ?? []), e]);

  const rows = [...bySong].sort().map(([song, list]) => `
    <h2>${esc(songTitles.get(song) ?? song)} <small>${list.length}</small></h2>
    ${list.map((e) => {
      const loc = e.loc;
      const warn = rightsWarning(loc);
      return `
      <article${warn ? ' class="warn"' : ''}>
        <p class="meta">
          <strong>${esc(loc?.performers?.[0] ?? 'performer unnamed')}</strong>
          · ${esc(String(loc?.date ?? '????').slice(0, 4))}
          ${loc?.place ? `· ${esc(loc.place)}` : ''}
          ${mmss(loc?.duration_seconds) ? `· ${mmss(loc.duration_seconds)}` : ''}
          · proposed: <code>${esc(e.delivery ?? '?')}</code>
        </p>
        ${warn ? `<p class="warnmsg">${esc(warn)}</p>` : ''}
        ${loc?.audio_url
          ? `<audio controls preload="none" src="${esc(loc.audio_url)}"></audio>`
          : '<p class="nometa">No metadata yet — run <code>pnpm fetch:loc</code>.</p>'}
        <form method="POST" action="/decide">
          <input type="hidden" name="loc_id" value="${esc(e.loc_id)}">
          <input type="hidden" name="filter" value="${esc(filter)}">
          <textarea name="note" rows="2"
            placeholder="What should a student listen for?">${esc(e.note ?? '')}</textarea>
          <div class="buttons">
            <button name="status" value="approved" class="yes">Approve</button>
            <button name="status" value="rejected" class="no">Reject</button>
            <a href="${esc(loc?.item_url ?? '#')}" target="_blank" rel="noreferrer">loc.gov</a>
            <span class="id">${esc(e.loc_id)}</span>
          </div>
        </form>
      </article>`;
    }).join('')}`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Vetting — ${entries.length} ${esc(filter)}</title>
<style>
  body { max-width: 48rem; margin: 0 auto; padding: 1rem;
         font: 1rem/1.5 system-ui, sans-serif; }
  nav a { margin-right: .75rem; }
  h2 { margin: 2rem 0 .5rem; border-bottom: 1px solid #8884; padding-bottom: .25rem; }
  h2 small { font-weight: normal; opacity: .6; }
  article { border: 1px solid #8884; border-radius: .4rem; padding: .75rem; margin: .75rem 0; }
  article.warn { border-color: #c60; background: #c6601a; }
  .meta { margin: 0 0 .5rem; }
  .warnmsg { margin: .25rem 0; font-weight: bold; color: #fff; background: #a40;
             padding: .4rem .6rem; border-radius: .3rem; }
  .nometa { font-style: italic; opacity: .7; }
  audio { width: 100%; }
  textarea { width: 100%; margin-top: .5rem; font: inherit; }
  .buttons { display: flex; gap: .5rem; align-items: center; margin-top: .4rem; }
  button { font: inherit; padding: .3rem .9rem; cursor: pointer; border-radius: .3rem; }
  .yes { background: #184; color: #fff; border: 0; }
  .no  { background: #822; color: #fff; border: 0; }
  .id { margin-left: auto; font-family: monospace; opacity: .6; font-size: .85rem; }
  :root { color-scheme: light dark; }
</style></head><body>
<h1>Vetting</h1>
<nav>
  <a href="/?filter=unreviewed">unreviewed</a>
  <a href="/?filter=approved">approved</a>
  <a href="/?filter=rejected">rejected</a>
  — writes to <code>${esc(MANIFEST)}</code>
</nav>
${entries.length === 0 ? `<p>Nothing ${esc(filter)}.</p>` : rows}
</body></html>`;
}

function songTitles() {
  const map = new Map();
  for (const s of parse(readFileSync(`${DATA_DIR}/songs.yaml`, 'utf8')) ?? []) {
    map.set(s.slug, s.title);
  }
  return map;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/decide') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const form = new URLSearchParams(body);
      const filter = form.get('filter') ?? 'unreviewed';
      try {
        const updated = applyDecision(
          readManifest(MANIFEST),
          form.get('loc_id'),
          form.get('status'),
          form.get('note'),
        );
        writeManifest(MANIFEST, updated);
        console.log(`  ${form.get('status').padEnd(8)} ${form.get('loc_id')}`);
      } catch (err) {
        console.error(`  failed: ${err.message}`);
      }
      res.writeHead(303, { Location: `/?filter=${filter}` }).end();
    });
    return;
  }

  const filter = url.searchParams.get('filter') ?? 'unreviewed';
  const entries = readManifest(MANIFEST).filter((e) => e.status === filter);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    .end(page(entries, songTitles(), filter));
});

if (import.meta.url === `file://${process.argv[1]}`) {
  // Localhost only. This writes to your manifest; it is not for exposing.
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Vetting at http://127.0.0.1:${PORT}  (writes ${MANIFEST})`);
    console.log('Ctrl-C to stop.');
  });
}
