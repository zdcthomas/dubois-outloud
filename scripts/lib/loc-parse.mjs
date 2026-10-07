/**
 * The loc.gov `rights` field is an array of HTML strings, for example
 * ['<p>The Library makes the sound recordings...</p>']. It goes into YAML and
 * then onto a page, so the markup comes off here, once, at the boundary.
 */
export function stripHtml(s) {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

function audioResources(json) {
  return (json.resources ?? []).filter((r) => typeof r.audio === 'string' && r.audio);
}

/**
 * Pick the audio resource to use.
 *
 * An item can expose the same recording twice: once as an ingested API copy
 * marked canDownload: false, and once as the collection copy marked true. We
 * prefer a downloadable one, otherwise `delivery: selfhost` would promise a
 * file the Library does not offer for download.
 */
function pickResource(resources) {
  const downloadable = resources.find((r) =>
    (r.files ?? []).flat().some((f) => f && f.canDownload === true),
  );
  return downloadable ?? resources[0];
}

function canDownload(resource) {
  return (resource.files ?? []).flat().some((f) => f && f.canDownload === true);
}

/**
 * loc.gov spreads performer credits over several keys, and the shape differs
 * between collections: sometimes an array of names, sometimes an object keyed
 * by name. Normalise to a deduplicated array of plain strings.
 */
function performersOf(item) {
  const out = new Set();
  for (const key of ['contributor_vocalist', 'contributor_primary', 'contributor']) {
    const v = item[key];
    if (Array.isArray(v)) for (const name of v) out.add(stripHtml(name));
    else if (typeof v === 'string') out.add(stripHtml(v));
    else if (v && typeof v === 'object') {
      for (const name of Object.keys(v)) out.add(stripHtml(name));
    }
  }
  return [...out].filter(Boolean);
}

/**
 * Every collection the item belongs to, lowercased as loc.gov supplies them.
 *
 * `item.partof` is an array of objects carrying a `title`, and the entry that
 * decides rights is never the first one: the 1917 Jukebox side lists a UCSB
 * department first and "national jukebox" second, and the Lomax item lists
 * four others before "american folklife center". Keeping only partof[0] throws
 * away the one fact the delivery rule needs, so all of them are reported and
 * scripts/lib/rights.mjs decides which matters.
 */
function collectionsOf(item) {
  const out = new Set();
  for (const entry of item.partof ?? []) {
    const title = entry && typeof entry === 'object' ? entry.title : entry;
    if (title) out.add(stripHtml(title));
  }
  return [...out].filter(Boolean);
}

function durationOf(resource) {
  for (const f of (resource.files ?? []).flat()) {
    if (f && typeof f.duration === 'number') return f.duration;
  }
  return null;
}

/**
 * loc.gov item JSON -> the `loc:` block stored in recordings.yaml.
 *
 * Returns null when the item exposes no audio at all, which happens when an
 * item is withdrawn or holds only images. Returning null rather than an object
 * with an undefined audio_url matters: scripts/fetch-loc.mjs treats null as
 * "leave what we already had alone" instead of overwriting good metadata with
 * a broken URL.
 */
export function parseItem(json, locId) {
  const item = json.item ?? {};
  const resources = audioResources(json);
  if (resources.length === 0) return null;

  const resource = pickResource(resources);
  const collections = collectionsOf(item);

  return {
    title: stripHtml(first(item.title) ?? locId),
    date: item.date ? String(item.date) : null,
    // `collection` is the display name; `collections` is what the delivery
    // rule reads, because the rights-bearing entry is not always first.
    collection: collections[0] ?? null,
    collections,
    performers: performersOf(item),
    place: first(item.location) ? stripHtml(first(item.location)) : null,
    duration_seconds: durationOf(resource),
    audio_url: resource.audio,
    can_download: canDownload(resource),
    rights: stripHtml(
      (Array.isArray(item.rights) ? item.rights : [item.rights ?? '']).join(' '),
    ),
    item_url: `https://www.loc.gov/item/${locId}/`,
  };
}
