// Which build this is, for the page (vite.config.ts, src/build.ts). A CI build (the Pages deploy) says
// where it came from: "build 42 · 28d5f88 · 2026-11-08" for a build-42 tag, "28d5f88 · 2026-11-08" for any
// other ref. A build that is not CI (the dev server, a local build.sh) says "dev · 28d5f88", so a report
// from a local build is never taken for a deploy. "dev · unknown" where git cannot tell the commit.
import { execSync } from 'node:child_process';

export function buildId(env: NodeJS.ProcessEnv = process.env, dev = false, now: Date = new Date()) {
  // dev.sh passes the host's HEAD as BUILD_COMMIT: in a worktree, git in the container cannot see the repo.
  const sha = env.GITHUB_SHA || env.BUILD_COMMIT;
  const commit = sha ? sha.slice(0, 7) : headCommit();
  if (dev || !env.GITHUB_SHA) return `dev · ${commit}`;
  const date = now.toISOString().slice(0, 10);
  const tag = /^build-(\d+)$/.exec(env.GITHUB_REF_NAME ?? '');
  return tag ? `build ${tag[1]} · ${commit} · ${date}` : `${commit} · ${date}`;
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
