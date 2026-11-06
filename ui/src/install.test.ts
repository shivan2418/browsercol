// @vitest-environment jsdom
import { expect, test } from 'vite-plus/test';
import { syncThemeColor } from './install';

test('the theme colour follows the menu bar token', () => {
  document.documentElement.style.setProperty('--menubar', '#0b0b0c');
  syncThemeColor();
  expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe('#0b0b0c');
  document.documentElement.style.setProperty('--menubar', '#3b2a17');
  syncThemeColor();
  expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe('#3b2a17');
});
