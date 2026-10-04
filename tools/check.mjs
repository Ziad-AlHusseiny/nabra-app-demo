#!/usr/bin/env node
// The gate in front of the public demo site (Story 7.8). It runs in Nabra after `npm run demo:site`, and again in the
// public repository's workflow before every deploy, so it uses only Node's standard library.
//
//   node check.mjs [site] [--required required.json]
//
// It fails when the site could leak something private (a source map, a local path, an internal code, a link into the
// private repository, any URL not on the short list below), carries a file that does not belong on a static app
// (audio above all), would break under the Pages sub-path, or has lost its demo labelling: the noindex tag and the
// app's own screener and sample-data lines, listed in required.json from the strings at build time.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** File types a built static app may hold. Anything else stops the deploy. */
const ALLOWED_TYPES = new Set(['.html', '.js', '.css', '.svg', '.woff', '.woff2', '.json', '.txt']);
const AUDIO_VIDEO = new Set([
  '.wav',
  '.mp3',
  '.webm',
  '.m4a',
  '.ogg',
  '.oga',
  '.flac',
  '.aac',
  '.mp4',
  '.mov',
]);
const TEXT_TYPES = new Set(['.html', '.js', '.css', '.svg', '.json', '.txt']);

/**
 * The only URLs the bundle may contain: XML namespaces and the libraries' own documentation links. A new one (a
 * library update, a link someone added) stops the deploy until a person has looked at it and added it here.
 */
const ALLOWED_URLS = [
  'http://www.w3.org/',
  'https://www.w3.org/',
  'https://react.dev/',
  'https://reactjs.org/',
  'https://reactrouter.com/',
  'https://github.com/ungap/',
  'http://localhost',
  'http://mock.local',
];

/** Text that must never be published, with the reason the error gives. */
const FORBIDDEN = [
  [/\/Users\//, 'a local path'],
  [/file:\/\//, 'a local file link'],
  [/sourceMappingURL/, 'a source map reference'],
  [/claude\.ai/, 'a link that needs a private Claude account'],
  [/nabra-pilot/, 'the old demo password, which reads like a real pilot password'],
  [/\bQ-\d{2}\b/, 'an internal question code'],
  [/\bN?FR-\d/, 'an internal requirement code'],
  [/\bNFR-[A-Z]{1,2}\d/, 'an internal requirement code'],
];
const DEMO_EMAIL = 'sara@school.edu.eg';
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_RE = /https?:\/\/[^\s"'`<>)\\]+/g;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/**
 * Check a built site folder. Returns a list of problems; an empty list means it may be published.
 * `required`: phrases that must appear in the app's scripts (its screener and sample-data lines).
 */
export function checkSite(site, { required = [] } = {}) {
  const errors = [];
  const index = join(site, 'index.html');
  if (!existsSync(index)) return [`${site}: index.html is missing`];
  if (!existsSync(join(site, '.nojekyll'))) errors.push('.nojekyll is missing');

  const source = join(site, 'source.json');
  if (!existsSync(source)) errors.push('source.json is missing (the commit the site was built from)');
  else {
    let commit = null;
    try {
      commit = JSON.parse(readFileSync(source, 'utf8')).commit;
    } catch {
      /* reported below */
    }
    if (!/^[0-9a-f]{40}$/.test(commit ?? '')) errors.push('source.json has no full commit hash');
  }

  let scripts = '';
  for (const path of files(site)) {
    const rel = relative(site, path);
    const name = rel.split(/[\\/]/).pop();
    const ext = extname(name).toLowerCase();
    if (name === '.nojekyll') continue;
    if (AUDIO_VIDEO.has(ext)) {
      errors.push(`${rel}: audio and video are never published (ETHICS.md)`);
      continue;
    }
    if (ext === '.map') {
      errors.push(`${rel}: a source map would publish the source code`);
      continue;
    }
    if (!ALLOWED_TYPES.has(ext)) {
      errors.push(`${rel}: this type of file does not belong on the site`);
      continue;
    }
    if (!TEXT_TYPES.has(ext)) continue;
    const text = readFileSync(path, 'utf8');
    if (ext === '.js') scripts += text;
    for (const [re, why] of FORBIDDEN) {
      const m = text.match(re);
      if (m) errors.push(`${rel}: contains «${m[0]}» (${why})`);
    }
    for (const url of new Set(text.match(URL_RE) ?? [])) {
      if (!ALLOWED_URLS.some((ok) => url.startsWith(ok)))
        errors.push(`${rel}: URL not on the allow-list: ${url}`);
    }
    for (const email of new Set(text.match(EMAIL) ?? [])) {
      if (email !== DEMO_EMAIL) errors.push(`${rel}: contains the email ${email}`);
    }
  }

  const html = readFileSync(index, 'utf8');
  if (/\s(?:src|href)=["']\/(?!\/)/.test(html) || /\s(?:src|href)=["']\/\//.test(html))
    errors.push('index.html: an absolute asset path; it breaks under the Pages sub-path (use ./)');
  if (!/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/.test(html))
    errors.push('index.html: the noindex tag is missing');
  if (!/<html[^>]*\blang=["']ar["']/.test(html) || !/<html[^>]*\bdir=["']rtl["']/.test(html))
    errors.push('index.html: <html> must be lang="ar" dir="rtl"');
  for (const phrase of required) {
    if (!scripts.includes(phrase)) errors.push(`the app's scripts lack the required line «${phrase}»`);
  }
  return errors;
}

function main(argv) {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = [...argv];
  const at = args.indexOf('--required');
  const requiredPath = at >= 0 ? args.splice(at, 2)[1] : null;
  const site = resolve(args[0] ?? join(here, '..', 'site'));
  const listPath =
    requiredPath ??
    [join(here, 'required.json'), join(site, '..', 'tools', 'required.json')].find(existsSync);
  if (!listPath) {
    console.error('required.json not found: pass --required <file> (npm run demo:site writes it to tools/)');
    return 1;
  }
  const { phrases = [] } = JSON.parse(readFileSync(listPath, 'utf8'));
  if (!phrases.length) {
    console.error(`${listPath}: no required phrases`);
    return 1;
  }
  const errors = checkSite(site, { required: phrases });
  if (errors.length) {
    console.error(
      `The site must not be published (${errors.length} problem${errors.length > 1 ? 's' : ''}):`,
    );
    for (const e of errors) console.error(`  - ${e}`);
    return 1;
  }
  console.log(`${site}: ok — nothing private, labelled as a demo, ready for Pages`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exit(main(process.argv.slice(2)));
