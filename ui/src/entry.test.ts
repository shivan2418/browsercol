// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { UNSUPPORTED_BROWSER } from './browser-support';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock('./main');
  document.body.innerHTML = '';
});

function loadingScreen() {
  document.body.innerHTML = `<div id="loading" role="progressbar" data-state="loading">
    <div data-loading-track></div><p data-loading-label>Loading</p></div>`;
  return document.getElementById('loading')!;
}

test('without Wasm GC the loading screen says which browsers to use, and the game is not loaded', async () => {
  const loading = loadingScreen();
  const main = vi.fn();
  vi.doMock('./main', () => {
    main();
    return {};
  });
  vi.stubGlobal('WebAssembly', { validate: () => false });
  await import('./entry');
  expect(loading.dataset.state).toBe('unsupported');
  expect(loading.getAttribute('role')).toBeNull();
  expect(loading.querySelector('[data-loading-label]')!.textContent).toBe(UNSUPPORTED_BROWSER);
  expect(main).not.toHaveBeenCalled();
});

test('with Wasm GC the game loads', async () => {
  const loading = loadingScreen();
  const main = vi.fn();
  vi.doMock('./main', () => {
    main();
    return {};
  });
  await import('./entry');
  await vi.waitFor(() => expect(main).toHaveBeenCalled());
  expect(loading.dataset.state).toBe('loading');
});
