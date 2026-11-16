import { expect, test } from 'vite-plus/test';
import { offlineFraction } from './offline-indicator';

test("the title screen's ring fills as the offline copy is saved, and is full once it is ready", () => {
  expect(offlineFraction({ state: 'saving', bytes: 30, totalBytes: 120 })).toBe(0.25);
  expect(offlineFraction({ state: 'updating', bytes: 0, totalBytes: 0 })).toBe(0);
  expect(offlineFraction({ state: 'ready', bytes: 0, totalBytes: 0 })).toBe(1);
  expect(offlineFraction({ state: 'failed', bytes: 50, totalBytes: 100 })).toBe(0);
  expect(offlineFraction({ state: 'saving', bytes: 130, totalBytes: 120 })).toBe(1);
});
