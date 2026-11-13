// The player changelog on the website (#402): ui/site/changes.json, which the /deploy skill fills in for each
// build, rendered at build time into plain HTML. tools/site.sh runs this after it copies the landing page:
// it writes <site>/changes/index.html, and puts the latest entries into <site>/index.html where that page has
// the <!-- latest-changes --> marker. Like the landing page it loads nothing from the Engine or the game's art.
//   node scripts/build-changes.ts <changes.json> <site dir>
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Entry {
  build: number;
  /** YYYY-MM-DD */
  date: string;
  new: string[];
  fixed: string[];
  changed: string[];
}

const GROUPS = [
  ['new', 'New'],
  ['fixed', 'Fixed'],
  ['changed', 'Changed'],
] as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const LATEST_MARKER = '<!-- latest-changes -->';
/** Around the landing page's "What's new" section, which is left out while there is nothing to show. */
export const SECTION_START = '<!-- changes-section -->';
export const SECTION_END = '<!-- /changes-section -->';

/** Text for an HTML body or a quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** "2026-11-09" as "9 November 2026"; anything else as it is. */
export function formatDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** Check the file's shape, so a bad entry fails the build rather than the page. A missing group is empty. */
export function parseChanges(data: unknown): Entry[] {
  if (!Array.isArray(data)) throw new Error('changes.json must be an array');
  return data.map((raw: unknown, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(o.build) || typeof o.date !== 'string') {
      throw new Error(`changes.json entry ${i}: needs a build number and a date`);
    }
    const lines = (key: string) => {
      const v = o[key] ?? [];
      if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
        throw new Error(`changes.json build ${String(o.build)}: "${key}" must be an array of strings`);
      }
      return v as string[];
    };
    return {
      build: o.build as number,
      date: o.date,
      new: lines('new'),
      fixed: lines('fixed'),
      changed: lines('changed'),
    };
  });
}

/** Newest build first, whatever order the file is in. */
function newestFirst(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((a, b) => b.build - a.build);
}

/** One build: its heading, then each group that has lines. */
export function renderEntry(entry: Entry, heading: 'h2' | 'h3' = 'h2'): string {
  const groups = GROUPS.filter(([key]) => entry[key].length > 0)
    .map(
      ([key, label]) =>
        `<h4 class="${key}">${label}</h4>\n<ul>\n${entry[key].map((s) => `<li>${escapeHtml(s)}</li>`).join('\n')}\n</ul>`,
    )
    .join('\n');
  return (
    `<article class="build" id="build-${entry.build}">\n` +
    `<${heading}>Build ${entry.build} <time datetime="${escapeHtml(entry.date)}">${escapeHtml(formatDate(entry.date))}</time></${heading}>\n` +
    `${groups}\n</article>`
  );
}

/** The builds, newest first. */
export function renderEntries(entries: readonly Entry[], heading: 'h2' | 'h3' = 'h2'): string {
  return newestFirst(entries)
    .map((e) => renderEntry(e, heading))
    .join('\n');
}

/** The landing page's share: the latest builds under its own "What's new" heading. */
export function renderLatest(entries: readonly Entry[], count = 2): string {
  return renderEntries(newestFirst(entries).slice(0, count), 'h3');
}

/** The page before the first public release: the list starts there, with no history before it. */
export const NOTHING_YET =
  '      <p class="note">Nothing yet. Changes are listed here from the first public release on.</p>';

/** The whole changes page, served at changes/. Its links climb one level to the site's root. */
export function renderChangesPage(entries: readonly Entry[]): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>What's new in BrowserCol</title>
    <meta name="description" content="What changed in each BrowserCol build: what is new, what is fixed and what works differently." />
    <meta name="color-scheme" content="light" />
    <link rel="icon" type="image/svg+xml" href="../play/icons/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="../play/icons/favicon-32.png" />
    <link rel="apple-touch-icon" href="../play/icons/apple-touch-icon.png" />
    <link rel="stylesheet" href="../site.css" />
  </head>
  <body>
    <header class="bar">
      <div class="wrap">
        <a href="../"><img src="../brand/icon.svg" alt="BrowserCol, home" width="30" height="30" /></a>
        <nav aria-label="Site">
          <a href="../">Home</a>
          <a href="../play/">Play</a>
          <a href="https://github.com/shivan2418/browsercol/issues">Report a bug</a>
        </nav>
      </div>
    </header>

    <main class="wrap changes">
      <h1>What's new</h1>
      <p class="lede">What changed in each build of BrowserCol, newest first.</p>
${entries.length > 0 ? renderEntries(entries, 'h2') : NOTHING_YET}
    </main>

    <footer>
      <div class="wrap">
        <ul>
          <li><a href="../">Home</a></li>
          <li><a href="../play/">Play</a></li>
          <li><a href="https://github.com/shivan2418/browsercol">Source on GitHub</a></li>
          <li><a href="https://github.com/shivan2418/browsercol/issues">Report a bug</a></li>
          <li><a href="../privacy/">Privacy</a></li>
        </ul>
        <p>BrowserCol is free software under the GNU General Public License, like FreeCol.</p>
      </div>
    </footer>
  </body>
</html>
`;
}

/** The landing page with its marker replaced by the latest builds, or its "What's new" section left out when there are none. */
export function fillLanding(html: string, entries: readonly Entry[]): string {
  for (const marker of [LATEST_MARKER, SECTION_START, SECTION_END]) {
    if (!html.includes(marker)) throw new Error(`the landing page has no ${marker}`);
  }
  if (entries.length === 0) {
    const start = html.indexOf(SECTION_START);
    return html.slice(0, start) + html.slice(html.indexOf(SECTION_END) + SECTION_END.length);
  }
  return html.replace(LATEST_MARKER, renderLatest(entries));
}

if (process.argv[1]?.endsWith('build-changes.ts')) {
  const [file, site] = process.argv.slice(2);
  if (!file || !site) throw new Error('usage: build-changes.ts <changes.json> <site dir>');
  const entries = parseChanges(JSON.parse(readFileSync(file, 'utf8')));
  mkdirSync(join(site, 'changes'), { recursive: true });
  writeFileSync(join(site, 'changes', 'index.html'), renderChangesPage(entries));
  const landing = join(site, 'index.html');
  writeFileSync(landing, fillLanding(readFileSync(landing, 'utf8'), entries));
  console.log(
    `changes: ${entries.length} builds${entries.length ? `, newest build ${newestFirst(entries)[0].build}` : ''}`,
  );
}
