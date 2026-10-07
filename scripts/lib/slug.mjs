/**
 * Title -> filename- and URL-safe slug.
 *
 * Song titles here carry apostrophes and commas ("Children, You'll Be Called
 * On"), and a slug becomes both a path segment and part of an MP3 filename.
 * Apostrophes are dropped rather than hyphenated, so "I've" reads as "ive"
 * instead of "i-ve". Both the straight and the typographic apostrophe are
 * dropped, because songs.yaml is hand-edited and will see both.
 */
export function slugify(title) {
  return title
    .normalize('NFKD')
    // Combining diacritics, written as escapes: a literal character class of
    // combining marks is invisible in a diff and mangles when copied.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '') // apostrophes vanish, they do not hyphenate
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
