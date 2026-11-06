// Which build this is, for the page (vite.config.ts, src/build.ts): "build 42 · 28d5f88" when CI builds
// a build-42 tag (the Pages deploy), the commit alone otherwise, "unknown" where neither can be told.
// The dev server says so: "dev · 28d5f88".
import { execSync } from 'node:child_process';

export function buildId(env: NodeJS.ProcessEnv = process.env, dev = false) {
  // dev.sh passes the host's HEAD as BUILD_COMMIT: in a worktree, git in the container cannot see the repo.
  const sha = env.GITHUB_SHA || env.BUILD_COMMIT;
  const commit = sha ? sha.slice(0, 7) : headCommit();
  if (dev) return `dev · ${commit}`;
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
