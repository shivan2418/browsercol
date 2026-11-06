// scripts/build-id.ts names the build the page shows; the test lives here, where Vitest looks.
import { expect, test } from 'vite-plus/test';
import { buildId } from '../scripts/build-id.ts';

const sha = '28d5f88be4b6c1300b9a1bfe93e5e3c10ca0c856';

test('a build-N tag names the build and its commit', () => {
  expect(buildId({ GITHUB_SHA: sha, GITHUB_REF_NAME: 'build-42' })).toBe('build 42 · 28d5f88');
});

test('any other CI ref names the commit alone', () => {
  expect(buildId({ GITHUB_SHA: sha, GITHUB_REF_NAME: 'main' })).toBe('28d5f88');
  expect(buildId({ GITHUB_SHA: sha, GITHUB_REF_NAME: 'build-next' })).toBe('28d5f88');
});

test('a local build names the commit dev.sh passes in', () => {
  expect(buildId({ BUILD_COMMIT: sha })).toBe('28d5f88');
});

test('the dev server says it is one', () => {
  expect(buildId({ BUILD_COMMIT: sha }, true)).toBe('dev · 28d5f88');
  expect(buildId({ GITHUB_SHA: sha, GITHUB_REF_NAME: 'build-42' }, true)).toBe('dev · 28d5f88');
});
