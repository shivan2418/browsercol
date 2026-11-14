// @vitest-environment jsdom
import { expect, test, vi } from 'vite-plus/test';
import { removeServiceWorker, syncThemeColor } from './install';

test('the theme colour follows the menu bar token', () => {
  document.documentElement.style.setProperty('--menubar', '#0b0b0c');
  syncThemeColor();
  expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe('#0b0b0c');
  document.documentElement.style.setProperty('--menubar', '#3b2a17');
  syncThemeColor();
  expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe('#3b2a17');
});

test('a service worker left by an offline build goes, with the copy it saved', async () => {
  const unregister = vi.fn();
  const deleted: string[] = [];
  vi.stubGlobal('caches', {
    keys: async () => ['browsercol-build-19', 'other'],
    delete: async (n: string) => deleted.push(n),
  });
  await removeServiceWorker({ getRegistrations: async () => [{ unregister }] } as never);
  expect(unregister).toHaveBeenCalled();
  expect(deleted).toEqual(['browsercol-build-19']);
  vi.unstubAllGlobals();
});
