// scripts/build-id.ts names the build the page shows; the test lives here, where Vitest looks.
import { expect, test } from 'vite-plus/test';
import { buildId } from '../scripts/build-id.ts';

const sha = '28d5f88be4b6c1300b9a1bfe93e5e3c10ca0c856';
const now = new Date('2026-11-08T23:59:00Z');

test('a build-N tag names the build, its commit and its date', () => {
  expect(buildId({ GITHUB_SHA: sha, GITHUB_REF_NAME: 'build-42' }, false, now)).toBe('build 42 · 28d5f88 · 2026-11-08');
});

test('any other CI ref names the commit and the date', () => {
  expect(buildId({ GITHUB_SHA: sha, GITHUB_REF_NAME: 'main' }, false, now)).toBe('28d5f88 · 2026-11-08');
  expect(buildId({ GITHUB_SHA: sha, GITHUB_REF_NAME: 'build-next' }, false, now)).toBe('28d5f88 · 2026-11-08');
});

test('a local build says it is local, with the commit dev.sh passes in', () => {
  expect(buildId({ BUILD_COMMIT: sha }, false, now)).toBe('dev · 28d5f88');
});

test('the dev server says it is one', () => {
  expect(buildId({ BUILD_COMMIT: sha }, true, now)).toBe('dev · 28d5f88');
  expect(buildId({ GITHUB_SHA: sha, GITHUB_REF_NAME: 'build-42' }, true, now)).toBe('dev · 28d5f88');
});
