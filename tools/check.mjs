#!/usr/bin/env node
// The gate in front of the public demo site (Story 7.8). It runs in Nabra when `npm run demo:site` builds, and again
// in the public repository's workflow before every deploy, so it uses only Node's standard library (and git when the
// folder is a checkout).
//
//   node check.mjs --repo [root] [--required required.json]   the whole public repository (the workflow runs this)
//   node check.mjs [site] [--required required.json]          a built site folder only
//
// It fails when something private could leak (a source map, a local path, an internal code, a link into the private
// repository, any web address not on the short list below, any email but the demo account's), when a file does not
// belong on a static app (audio above all, also inlined as a data: URI), when the site would break under the Pages
// sub-path, when the repository holds anything but its expected files, or when the demo labelling is gone: the noindex
// tag and the app's own screener and sample-data lines, listed in required.json from the strings at build time.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The strings (keys of src/mock/strings.ar.json) whose text proves the published build is the labelled demo. */
export const REQUIRED_KEYS = [
  'notice.title',
  's01.foot',
  's01.demo_hint',
  'sample.result',
  'sample.report',
  'demo.toggle',
];
/** Added to the published index.html: a demo for reviewers, not for search engines. */
export const NOINDEX = '<meta name="robots" content="noindex, nofollow" />';

/** File types a built static app may hold. Anything else stops the deploy. */
const ALLOWED_TYPES = new Set(['.html', '.js', '.css', '.svg', '.woff', '.woff2', '.json', '.txt']);
const TEXT_TYPES = new Set(['.html', '.js', '.css', '.svg', '.json', '.txt']);
const AUDIO_VIDEO = new Set([
  '.wav',
  '.mp3',
  '.webm',
  '.m4a',
  '.ogg',
  '.oga',
  '.opus',
  '.flac',
  '.aac',
  '.mp4',
  '.mov',
]);
/** Inlined files (data: URIs) the build may hold: its fonts and small icons. */
const ALLOWED_DATA = new Set(['font/woff2', 'font/woff', 'image/svg+xml']);

/**
 * The only web addresses the site may contain: XML namespaces and the libraries' own documentation links, compared by
 * exact origin and path. A new one (a library update, a link someone added) stops the deploy until a person has
 * looked at it and added it here.
 */
const ALLOWED_URLS = [
  { origin: 'http://www.w3.org' },
  { origin: 'https://www.w3.org' },
  { origin: 'https://react.dev' },
  { origin: 'https://reactjs.org' },
  { origin: 'https://reactrouter.com' },
  { origin: 'https://github.com', path: '/ungap/' },
];
/** Bases the router and the mock use to parse paths: allowed exactly as written, never with a port or a path. */
const PARSING_BASES = new Set(['http://localhost', 'http://mock.local', 'server://singlefetch/']);
/** The public repository's own README may also link to the demo itself. */
const REPO_URLS = [
  { origin: 'https://ziad-alhusseiny.github.io', path: '/nabra-app-demo/' },
  { origin: 'https://github.com', path: '/Ziad-AlHusseiny/nabra-app-demo' },
];

// built from parts, so that this file, which is published too, does not carry it
const OLD_PASSWORD = ['nabra', 'pilot'].join('-');
/** Text that must never be published, with the reason the error gives. */
const FORBIDDEN = [
  [/\/Users\//, 'a local path'],
  [/file:\/\//i, 'a local file link'],
  [/sourceMappingURL/i, 'a source map reference'],
  [/claude\.ai/i, 'a link that needs a private Claude account'],
  [/Ziad-AlHusseiny\/nabra(?![-\w])/i, 'a link into the private repository'],
  [new RegExp(OLD_PASSWORD, 'i'), 'the old demo password, which reads like a real pilot password'],
  [/\bQ-\d{2}\b/, 'an internal question code'],
  [/\bN?FR-\d/, 'an internal requirement code'],
  [/\bNFR-[A-Z]{1,2}\d/, 'an internal requirement code'],
];
const DEMO_EMAIL = 'sara@school.edu.eg';
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// any scheme, any case; and protocol-relative addresses (//host.tld/…)
const URL_RE =
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>)\\]+|(?<![\w:/\\])\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#][^\s"'`<>)\\]*)?/gi;
const DATA_RE = /\bdata:([a-z]+\/[a-z0-9.+-]+)[;,]/gi;

/** The repository's expected files, besides everything under site/. */
const REPO_FILES = new Set([
  'README.md',
  '.gitignore',
  'tools/check.mjs',
  'tools/required.json',
  '.github/workflows/pages.yml',
]);
/** The repository's own text files, scanned like the site (tools/check.mjs is this file: it names what it forbids). */
const REPO_TEXT = ['README.md', '.gitignore', 'tools/required.json', '.github/workflows/pages.yml'];

function urlAllowed(raw, extra = []) {
  if (PARSING_BASES.has(raw)) return true;
  if (raw.startsWith('//')) return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // the scheme as written: a capitalised HTTPS:// is not what any build writes
  if (!['http:', 'https:'].includes(url.protocol) || !raw.startsWith(url.protocol)) return false;
  return [...ALLOWED_URLS, ...extra].some(
    (a) => url.origin === a.origin && url.pathname.startsWith(a.path ?? '/'),
  );
}

/** Everything one text file must not carry. */
function scan(rel, text, errors, extraUrls = []) {
  for (const [re, why] of FORBIDDEN) {
    const m = text.match(re);
    if (m) errors.push(`${rel}: contains «${m[0]}» (${why})`);
  }
  for (const url of new Set(text.match(URL_RE) ?? [])) {
    if (!urlAllowed(url, extraUrls)) errors.push(`${rel}: web address not on the allow-list: ${url}`);
  }
  for (const [, type] of text.matchAll(DATA_RE)) {
    const t = type.toLowerCase();
    if (/^(audio|video)\//.test(t))
      errors.push(`${rel}: an inlined ${t} file (audio and video are never published)`);
    else if (!ALLOWED_DATA.has(t)) errors.push(`${rel}: an inlined data:${t} file`);
  }
  for (const email of new Set(text.match(EMAIL) ?? [])) {
    if (email.toLowerCase() !== DEMO_EMAIL) errors.push(`${rel}: contains the email ${email}`);
  }
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * Check a built site folder. Returns a list of problems; an empty list means it may be published.
 * `required`: phrases that must appear in the app's scripts (its screener and sample-data lines).
 */
export function checkSite(site, { required = [], prefix = '' } = {}) {
  const errors = [];
  const index = join(site, 'index.html');
  if (!existsSync(index)) return [`${prefix}index.html is missing`];
  const marker = join(site, '.nojekyll');
  if (!existsSync(marker)) errors.push(`${prefix}.nojekyll is missing`);
  else if (statSync(marker).size) errors.push(`${prefix}.nojekyll must be empty`);

  const source = join(site, 'source.json');
  if (!existsSync(source))
    errors.push(`${prefix}source.json is missing (the commit the site was built from)`);
  else {
    let commit = null;
    try {
      commit = JSON.parse(readFileSync(source, 'utf8')).commit;
    } catch {
      /* reported below */
    }
    if (!/^[0-9a-f]{40}$/.test(commit ?? '')) errors.push(`${prefix}source.json has no full commit hash`);
  }

  let scripts = '';
  for (const path of walk(site)) {
    const rel = relative(site, path).split(sep).join('/');
    const at = `${prefix}${rel}`;
    if (rel === '.nojekyll') continue;
    const ext = extname(rel).toLowerCase();
    if (AUDIO_VIDEO.has(ext)) {
      errors.push(`${at}: audio and video are never published (ETHICS.md)`);
      continue;
    }
    if (ext === '.map') {
      errors.push(`${at}: a source map would publish the source code`);
      continue;
    }
    if (!ALLOWED_TYPES.has(ext) || rel.split('/').pop().startsWith('.')) {
      errors.push(`${at}: this type of file does not belong on the site`);
      continue;
    }
    if (!TEXT_TYPES.has(ext)) continue;
    const text = readFileSync(path, 'utf8');
    if (ext === '.js') scripts += text;
    scan(at, text, errors);
  }

  const html = readFileSync(index, 'utf8');
  if (/\s(?:src|href)=["']\/(?!\/)/.test(html))
    errors.push(`${prefix}index.html: an absolute asset path; it breaks under the Pages sub-path (use ./)`);
  if (!html.includes(NOINDEX)) errors.push(`${prefix}index.html: the noindex tag is missing`);
  if (!/<html[^>]*\blang=["']ar["']/.test(html))
    errors.push(`${prefix}index.html: <html> must have lang="ar"`);
  if (!/<html[^>]*\bdir=["']rtl["']/.test(html))
    errors.push(`${prefix}index.html: <html> must have dir="rtl"`);
  for (const phrase of required) {
    if (!scripts.includes(phrase)) errors.push(`the app's scripts lack the required line «${phrase}»`);
  }
  return errors;
}

/** The files `git add -A` would publish (tracked and new, not ignored), or every file when this is not a checkout. */
function repoFiles(root) {
  if (existsSync(join(root, '.git'))) {
    try {
      const out = execFileSync(
        'git',
        ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        {
          encoding: 'utf8',
        },
      );
      return out.split('\0').filter(Boolean);
    } catch {
      /* no git here: walk the folder */
    }
  }
  return walk(root)
    .map((p) => relative(root, p).split(sep).join('/'))
    .filter((p) => !p.startsWith('.git/'));
}

/** Check the whole public repository: its layout, its own text files, and the site. */
export function checkRepo(root, { required = [] } = {}) {
  const errors = [];
  for (const rel of repoFiles(root)) {
    if (!rel.startsWith('site/') && !REPO_FILES.has(rel))
      errors.push(
        `${rel}: not part of the public repository (only site/, tools/, the Pages workflow and the README)`,
      );
  }
  for (const rel of REPO_TEXT) {
    const path = join(root, rel);
    if (existsSync(path)) scan(rel, readFileSync(path, 'utf8'), errors, REPO_URLS);
    else if (rel !== '.gitignore') errors.push(`${rel} is missing`);
  }
  return [...errors, ...checkSite(join(root, 'site'), { required, prefix: 'site/' })];
}

function main(argv) {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = [...argv];
  const take = (flag, withValue) => {
    const at = args.indexOf(flag);
    if (at < 0) return null;
    return withValue ? args.splice(at, 2)[1] : (args.splice(at, 1), true);
  };
  const requiredPath = take('--required', true);
  const repoMode = take('--repo', false);
  const target = resolve(args[0] ?? join(here, '..', repoMode ? '' : 'site'));
  const root = repoMode ? target : join(target, '..');
  const listPath =
    requiredPath ?? [join(here, 'required.json'), join(root, 'tools', 'required.json')].find(existsSync);
  if (!listPath) {
    console.error('required.json not found: pass --required <file> (npm run demo:site writes it to tools/)');
    return 1;
  }
  const { phrases = [] } = JSON.parse(readFileSync(listPath, 'utf8'));
  if (!phrases.length) {
    console.error(`${listPath}: no required phrases`);
    return 1;
  }
  const errors = repoMode
    ? checkRepo(target, { required: phrases })
    : checkSite(target, { required: phrases });
  if (errors.length) {
    console.error(`Must not be published (${errors.length} problem${errors.length > 1 ? 's' : ''}):`);
    for (const e of errors) console.error(`  - ${e}`);
    return 1;
  }
  console.log(`${target}: ok — nothing private, labelled as a demo, ready for Pages`);
  return 0;
}

// real paths on both sides: a symlinked folder (macOS /tmp) must still run the check, never skip it silently
const self = realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === self)
  process.exit(main(process.argv.slice(2)));
