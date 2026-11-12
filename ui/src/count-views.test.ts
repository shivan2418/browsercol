// scripts/count-views.ts puts GoatCounter's counter on the deployed pages; the test lives here, where Vitest looks.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vite-plus/test';
import { counter, countUrl, withCounter } from '../scripts/count-views.ts';

const url = 'https://browsercol.goatcounter.com/count';

test('counts nothing without a URL, and takes only a GoatCounter count endpoint', () => {
  expect(countUrl(undefined)).toBeNull();
  expect(countUrl('  ')).toBeNull();
  expect(countUrl(` ${url}\n`)).toBe(url);
  for (const bad of [
    'http://browsercol.goatcounter.com/count',
    'https://browsercol.goatcounter.com/',
    'https://evil.example/count',
    'https://x.goatcounter.com/count"></script>',
  ]) {
    expect(() => countUrl(bad), bad).toThrow('GOATCOUNTER_URL');
  }
});

test('puts the counter last in the head, once', () => {
  const page = '<html>\n  <head>\n    <title>BrowserCol</title>\n  </head>\n  <body></body>\n</html>\n';
  const counted = withCounter(page, url);
  expect(counted.indexOf(url)).toBeGreaterThan(counted.indexOf('<title>'));
  expect(counted.indexOf(url)).toBeLessThan(counted.indexOf('</head>'));
  expect(withCounter(counted, url)).toBe(counted);
  expect(() => withCounter('<p>no head</p>', url)).toThrow('</head>');
});

test('fits the landing page and the game page', () => {
  for (const file of ['../site/index.html', '../index.html']) {
    expect(withCounter(readFileSync(new URL(file, import.meta.url), 'utf8'), url)).toContain(counter(url));
  }
});

test('counts a view by its path, sets nothing in the browser, and skips a browser a test drives', () => {
  const sent: string[] = [];
  class FakeImage {
    set src(s: string) {
      sent.push(s);
    }
  }
  // The snippet as the page runs it, in a context of its own with only what a page would give it.
  const run = (webdriver: boolean) =>
    runInNewContext(/<script>([\s\S]*)<\/script>/.exec(counter(url))![1], {
      navigator: { webdriver },
      location: { pathname: '/play/', search: '?save=3' },
      document: { title: 'BrowserCol', referrer: 'https://www.reddit.com/' },
      Image: FakeImage,
      URLSearchParams,
    });
  run(true);
  expect(sent).toEqual([]);
  run(false);
  expect(sent).toHaveLength(1);
  const q = new URL(sent[0]).searchParams;
  expect(sent[0].startsWith(`${url}?`)).toBe(true);
  expect(q.get('p')).toBe('/play/');
  expect(q.get('r')).toBe('https://www.reddit.com/');
  expect(sent[0]).not.toContain('save');
  expect(counter(url)).not.toMatch(/cookie|localStorage|sessionStorage/);
});
