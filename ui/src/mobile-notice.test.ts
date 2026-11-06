// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vite-plus/test';
import { isPhone, mobileNotice, type Env } from './mobile-notice';

const env = (media: string[], innerWidth: number, innerHeight: number): Env => ({
  matchMedia: (q) => ({ matches: media.includes(q) }),
  innerWidth,
  innerHeight,
});
const phone = env(['(pointer: coarse)'], 390, 844);
const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

beforeEach(() => {
  document.body.innerHTML = '';
});

test('a phone is a coarse pointer with no fine one and a small screen, in either orientation', () => {
  expect(isPhone(phone)).toBe(true);
  expect(isPhone(env(['(pointer: coarse)'], 844, 390))).toBe(true);
});

test('a desktop, a touch laptop and a tablet are not phones', () => {
  expect(isPhone(env(['(pointer: fine)'], 390, 844))).toBe(false); // a narrow desktop window
  expect(isPhone(env(['(pointer: coarse)', '(any-pointer: fine)'], 390, 844))).toBe(false); // a touch laptop
  expect(isPhone(env(['(pointer: coarse)'], 820, 1180))).toBe(false); // a tablet
});

test('the notice shows on a phone and goes when dismissed, for the rest of the tab', () => {
  const storage = store();
  const notice = mobileNotice(document, phone, storage);
  expect(document.getElementById('mobile-notice')).toBe(notice);
  expect(notice?.textContent).toContain('not mobile-compatible yet');
  document.querySelector<HTMLElement>('[data-dismiss]')!.click();
  expect(document.getElementById('mobile-notice')).toBeNull();
  expect(mobileNotice(document, phone, storage)).toBeNull();
});

test('no notice off a phone', () => {
  expect(mobileNotice(document, env(['(pointer: fine)'], 1280, 800), store())).toBeNull();
  expect(document.getElementById('mobile-notice')).toBeNull();
});
