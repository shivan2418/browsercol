import { expect, test } from 'vite-plus/test';
import { flag } from './flag';

test('a flag is present when on and left out when off', () => {
  expect(flag(true)).toBe('');
  expect(flag('x')).toBe('');
  expect(flag(false)).toBeUndefined();
  expect(flag(null)).toBeUndefined();
  expect(flag(undefined)).toBeUndefined();
  expect(flag(0)).toBeUndefined();
});
