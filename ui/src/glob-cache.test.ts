// Vitest's file cache (node_modules/.vitest-cache) keeps a transformed module until its own source changes, so a
// module that globs other files must stay out of it: Vitest leaves out only a source that says "import.meta.glob(".
// With a type argument (import.meta.glob<string>(...)) it is cached, and later runs miss files added since (#500).
import { describe, expect, it } from 'vite-plus/test';

const sources = import.meta.glob(['./*.ts', './*.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

describe('the globs', () => {
  it('take no type argument, so Vitest never caches what they found', () => {
    const typed = new RegExp(String.raw`import\.meta\.glob\s*<`);
    expect(Object.keys(sources).filter((f) => typed.test(sources[f]))).toEqual([]);
  });
});
