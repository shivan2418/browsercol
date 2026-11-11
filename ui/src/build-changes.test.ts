// scripts/build-changes.ts renders the player changelog for the website; the test lives here, where Vitest looks.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';
import {
  LATEST_MARKER,
  fillLanding,
  formatDate,
  parseChanges,
  renderChangesPage,
  renderEntries,
  renderLatest,
  type Entry,
} from '../scripts/build-changes.ts';

const entries: Entry[] = [
  { build: 3, date: '2026-11-09', new: ['Newest thing'], fixed: [], changed: [] },
  { build: 2, date: '2026-11-07', new: [], fixed: ['Middle fix'], changed: ['Middle change'] },
  { build: 1, date: '2026-11-06', new: ['Oldest thing'], fixed: ['Oldest fix'], changed: ['Oldest change'] },
];

test('every entry shows', () => {
  const html = renderEntries(entries);
  for (const e of entries) expect(html).toContain(`id="build-${e.build}"`);
  for (const line of ['Newest thing', 'Middle fix', 'Middle change', 'Oldest thing', 'Oldest fix', 'Oldest change']) {
    expect(html).toContain(`<li>${line}</li>`);
  }
});

test('the newest build comes first, whatever order the file is in', () => {
  const html = renderEntries([entries[1], entries[2], entries[0]]);
  expect(html.indexOf('Build 3')).toBeLessThan(html.indexOf('Build 2'));
  expect(html.indexOf('Build 2')).toBeLessThan(html.indexOf('Build 1'));
});

test('a group with no lines is left out, and the others keep their order', () => {
  const html = renderEntries([entries[0]]);
  expect(html).toContain('>New</h4>');
  expect(html).not.toContain('>Fixed</h4>');
  expect(html).not.toContain('>Changed</h4>');
  const all = renderEntries([entries[2]]);
  expect(all.indexOf('>New</h4>')).toBeLessThan(all.indexOf('>Fixed</h4>'));
  expect(all.indexOf('>Fixed</h4>')).toBeLessThan(all.indexOf('>Changed</h4>'));
});

test('text is HTML-escaped', () => {
  const html = renderEntries([
    { build: 1, date: '2026-11-06', new: ['<script>alert("x")</script> & more'], fixed: [], changed: [] },
  ]);
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more');
});

test('the date reads as a date, and is kept as it is when it is not one', () => {
  expect(formatDate('2026-11-09')).toBe('9 November 2026');
  expect(formatDate('soon')).toBe('soon');
  expect(renderEntries([entries[0]])).toContain('<time datetime="2026-11-09">9 November 2026</time>');
});

test('the landing page gets the latest two builds, and the changes page all of them', () => {
  const latest = renderLatest(entries);
  expect(latest).toContain('Build 3');
  expect(latest).toContain('Build 2');
  expect(latest).not.toContain('Build 1');
  const page = renderChangesPage(entries);
  expect(page).toContain('Build 1');
  expect(page).toContain('href="../site.css"');
  const landing = fillLanding(`<p>a</p>${LATEST_MARKER}<p>b</p>`, entries);
  expect(landing).not.toContain(LATEST_MARKER);
  expect(landing).toContain('Build 3');
  expect(() => fillLanding('<p>none</p>', entries)).toThrow();
});

test('the file in ui/site has the shape the page needs, newest first', () => {
  const real = parseChanges(JSON.parse(readFileSync(new URL('../site/changes.json', import.meta.url), 'utf8')));
  expect(real.length).toBeGreaterThan(0);
  expect(real.map((e) => e.build)).toEqual(real.map((e) => e.build).sort((a, b) => b - a));
  for (const e of real) expect(e.new.length + e.fixed.length + e.changed.length).toBeGreaterThan(0);
});

test('a malformed file fails rather than rendering half a page', () => {
  expect(() => parseChanges({})).toThrow();
  expect(() => parseChanges([{ build: 'x', date: '2026-11-06' }])).toThrow();
  expect(() => parseChanges([{ build: 1, date: '2026-11-06', new: 'one line' }])).toThrow();
  expect(parseChanges([{ build: 1, date: '2026-11-06' }])[0].fixed).toEqual([]);
});
