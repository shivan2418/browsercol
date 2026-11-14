// Every test fails on React's warning of a duplicate or missing key (R-9EGSK). In a browser a duplicate key makes
// React keep stale rows; the warning is the only sign of it, and it is printed in development builds and tests only.
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

const KEY_WARNING = /Encountered two children with the same key|Each child in a list should have a unique "key"/;
let warnings = new Set<string>();

beforeEach(() => {
  warnings = new Set();
  const error = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (KEY_WARNING.test(text)) warnings.add(text);
    error(...args);
  });
});

afterEach(() => {
  const found = [...warnings];
  warnings = new Set();
  expect(found, "React's key warnings").toEqual([]);
});
