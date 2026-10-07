import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* htmlFiles(path);
    else if (name.endsWith('.html')) yield path;
  }
}

function exists(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (clean === '' || clean === '/') return true;
  const base = join(DIST, decodeURIComponent(clean));
  try {
    return statSync(base).isDirectory()
      ? statSync(join(base, 'index.html')).isFile()
      : statSync(base).isFile();
  } catch {
    return false;
  }
}

const broken = [];
for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    if (!exists(m[1])) broken.push(`${file} -> ${m[1]}`);
  }
}

if (broken.length > 0) {
  console.error(`${broken.length} broken internal links:`);
  for (const line of broken) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('No broken internal links.');
