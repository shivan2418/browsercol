// Which build the page is, from vite.config.ts: "build 42 · 28d5f88" for a deploy from a build-42 tag,
// the commit alone otherwise. Shown on the start screen and in the credits, and copied into error details,
// so a report says which code it came from.
declare global {
  const __BUILD__: string | undefined;
}

export const BUILD = typeof __BUILD__ === 'undefined' ? 'unknown' : __BUILD__;
