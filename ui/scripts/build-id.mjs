// The commit this build is of, for the error panel's details (vite.config.ts); "unknown" where it cannot be told.
import { execSync } from 'node:child_process';

export function buildId() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}
