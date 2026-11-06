// Which build this is, for the page (vite.config.ts, src/build.ts): "build 42 · 28d5f88" when CI builds
// a build-42 tag (the Pages deploy), the commit alone otherwise, "unknown" where neither can be told.
import { execSync } from 'node:child_process';

export function buildId(env: NodeJS.ProcessEnv = process.env) {
  const commit = env.GITHUB_SHA ? env.GITHUB_SHA.slice(0, 7) : headCommit();
  const tag = /^build-(\d+)$/.exec(env.GITHUB_REF_NAME ?? '');
  return tag ? `build ${tag[1]} · ${commit}` : commit;
}

function headCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}
