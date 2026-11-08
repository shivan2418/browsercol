// Which build the page is, from vite.config.ts: "build 42 · 28d5f88 · 2026-11-08" for a deploy from a
// build-42 tag, "28d5f88 · 2026-11-08" for another CI build, "dev · 28d5f88" for a local one
// (ui/scripts/build-id.ts). The one place the version is read from: shown on the start screen and in the
// credits, copied into error details and (#369) put in every feedback report, so a report says which code
// it came from.
declare global {
  const __BUILD__: string | undefined;
}

export const BUILD = typeof __BUILD__ === 'undefined' ? 'unknown' : __BUILD__;
