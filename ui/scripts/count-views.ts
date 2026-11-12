// Page views on the website and the game (GoatCounter, docs/adr/0011): tools/site.sh runs this on the deployed site
// when the GOATCOUNTER_URL repository variable is set, and puts a few lines in each page's <head> that ask GoatCounter
// to count the view. No cookie, no script from elsewhere, nothing stored in the browser: GoatCounter tells visitors
// apart by a hash of their address and browser that it keeps for a day. A page loads and plays the same when the
// request is blocked or fails. Without the variable (a local build, a fork) nothing is counted.
//   node scripts/count-views.ts <site dir>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The pages counted, from the site's root: the landing page, the changes page and the game. */
export const COUNTED_PAGES = ['index.html', 'changes/index.html', 'play/index.html'];

/** GoatCounter's count endpoint for a site code: https://<code>.goatcounter.com/count. */
const ENDPOINT = /^https:\/\/[a-z0-9-]+\.goatcounter\.com\/count$/;

/** The endpoint, checked, or null for none: an unset or empty variable counts nothing. */
export function countUrl(value: string | undefined): string | null {
  const url = value?.trim();
  if (!url) return null;
  if (!ENDPOINT.test(url)) throw new Error(`GOATCOUNTER_URL must be https://<code>.goatcounter.com/count, not ${url}`);
  return url;
}

/**
 * The script that counts one view of the page. A browser driven by a test (the smoke run against the live site sets
 * navigator.webdriver) is not counted; the path is counted without its query, which can name a save or a debug flag.
 */
export function counter(url: string): string {
  return `<script>
      (() => {
        if (navigator.webdriver) return;
        const q = new URLSearchParams({ p: location.pathname, t: document.title, r: document.referrer, rnd: String(Math.random()) });
        new Image().src = ${JSON.stringify(url)} + '?' + q;
      })();
    </script>`;
}

/** The page with the counter last in its head; a page counted already is left as it is. */
export function withCounter(html: string, url: string): string {
  if (html.includes(url)) return html;
  if (!html.includes('</head>')) throw new Error('the page has no </head>');
  return html.replace('</head>', `  ${counter(url)}\n  </head>`);
}

if (process.argv[1]?.endsWith('count-views.ts')) {
  const [site] = process.argv.slice(2);
  if (!site) throw new Error('usage: count-views.ts <site dir>');
  const url = countUrl(process.env.GOATCOUNTER_URL);
  if (url === null) {
    console.log('views: not counted (no GOATCOUNTER_URL)');
  } else {
    const pages = COUNTED_PAGES.filter((p) => existsSync(join(site, p)));
    for (const page of pages) writeFileSync(join(site, page), withCounter(readFileSync(join(site, page), 'utf8'), url));
    console.log(`views: counted on ${pages.join(', ')}`);
  }
}
