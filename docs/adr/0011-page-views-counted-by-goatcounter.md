# Page views are counted by GoatCounter, through a few lines of our own script

To know how many people come to the website and open the game, the deployed site counts page views with GoatCounter, a hosted, open-source counter that sets no cookies. `tools/site.sh` puts a few inline lines (`ui/scripts/count-views.ts`) in the `<head>` of the landing page, the changes page and `/play/`. They ask `https://<code>.goatcounter.com/count` for an image with the page's path, title and referrer. GoatCounter tells visitors apart by a hash of address and browser that it keeps for a day, so the browser stores nothing and no consent banner is needed.

This follows ADR 0009's rule for side channels: the game does not need it. No script loads from GoatCounter's servers, so ADR 0001's concern about a third party's runtime does not arise, and a blocked or failed request changes nothing on the page.

## Considered Options

- **Our relay with CloudWatch metrics:** rejected for now. All the data stays in our account, but it gives no unique visitors and no referrers, and it needs a relay deploy and graphs built by hand.
- **Cloudflare Web Analytics:** rejected. It needs a Cloudflare account, its beacon script loads from Cloudflare's CDN, and it has no custom events.
- **GoatCounter's own `count.js`:** rejected. Its features (single-page navigation, event helpers) aren't needed for one view per page load, and the inline lines are a dozen we own.

## Consequences

- The counter is added when the site is deployed, not when the game is built. The `GOATCOUNTER_URL` repository variable turns it on; unset (a local build, a fork), nothing is counted. A change to it takes effect on the next Site workflow run, without a new build of the game.
- The released `play.tar.gz` has no counter in it, so the live `/play/index.html` differs from the release's. The Pages workflow's "live game is this build" step compares the hashed script name instead of the whole file.
- A browser driven by a test (`navigator.webdriver`, as in the smoke run against the live site) is not counted, and a page's query string is never sent.
- Only views are counted. Events in the game, such as a game started, would need the game build to know the URL too.
