// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';
import { dismissHint, hintDismissed, isIosBrowserTab, showsHomeScreenHint, type IosEnv } from './ios-home-screen';
import { HomeScreenHint, IosSavesWarning } from './ios-notes';
import { SaveDialog } from './save-picker';

const env = (over: Partial<IosEnv>): IosEnv => ({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
  platform: 'Linux x86_64',
  maxTouchPoints: 0,
  ...over,
});
const iphone = env({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1',
  platform: 'iPhone',
  maxTouchPoints: 5,
});
const ipados = env({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 5,
});
const mac = env({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', platform: 'MacIntel' });
const android = env({
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile',
  platform: 'Linux armv81',
  maxTouchPoints: 5,
});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

test('an iPhone or iPad in a Safari tab is told; iPadOS reports as a Mac with touch points', () => {
  expect(isIosBrowserTab(iphone)).toBe(true);
  expect(isIosBrowserTab(ipados)).toBe(true);
});

test('a Mac, Android, desktop and an installed page are not', () => {
  expect(isIosBrowserTab(mac)).toBe(false);
  expect(isIosBrowserTab(android)).toBe(false);
  expect(isIosBrowserTab(env({}))).toBe(false);
  expect(isIosBrowserTab({ ...iphone, standalone: true })).toBe(false);
  expect(isIosBrowserTab({ ...ipados, matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }) })).toBe(
    false,
  );
  expect(isIosBrowserTab({ ...iphone, standalone: false, matchMedia: () => ({ matches: false }) })).toBe(true);
});

test('the saves warning shows in a Safari tab only, and names the Home Screen and saving to a file', () => {
  const { container, rerender } = render(<IosSavesWarning env={iphone} />);
  expect(container.textContent).toMatch(/week away.*Home Screen.*Save to a file/);
  rerender(<IosSavesWarning env={android} />);
  expect(container.textContent).toBe('');
});

test('the save dialog carries the warning where the page is an iPhone tab', () => {
  Object.defineProperty(navigator, 'userAgent', { value: iphone.userAgent, configurable: true });
  render(<SaveDialog title="Save Game" save={() => {}} close={() => {}} />);
  expect(document.querySelector('[data-ios-saves-warning]')).not.toBeNull();
  Object.defineProperty(navigator, 'userAgent', { value: env({}).userAgent, configurable: true });
});

test('the hint shows on an iPhone, and stays away once dismissed, per device', () => {
  expect(showsHomeScreenHint(iphone)).toBe(true);
  expect(showsHomeScreenHint(android)).toBe(false);
  render(<HomeScreenHint env={iphone} />);
  expect(screen.getByText(/Add to Home Screen to play full screen and keep your saves/)).toBeTruthy();
  expect(document.body.textContent).toContain('Share');
  fireEvent.click(document.querySelector('[data-home-screen-dismiss]')!);
  expect(document.querySelector('[data-home-screen-hint]')).toBeNull();
  expect(hintDismissed()).toBe(true);
  expect(showsHomeScreenHint(iphone)).toBe(false);
});

test('blocked storage does not break the hint', () => {
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  expect(hintDismissed(blocked)).toBe(false);
  expect(() => dismissHint(blocked)).not.toThrow();
  expect(showsHomeScreenHint(iphone, blocked)).toBe(true);
});
