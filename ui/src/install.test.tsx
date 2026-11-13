// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vite-plus/test';
import { registerServiceWorker, syncThemeColor, type Registrar } from './install';
import { UpdatePrompt } from './update-prompt';

/** A browser with a service worker container, and the registration it hands back. */
function browser(controller: object | null, waiting: object | null) {
  const registration = Object.assign(new EventTarget(), {
    waiting,
    installing: null as object | null,
    update: vi.fn(),
  });
  const container = Object.assign(new EventTarget(), {
    controller,
    register: vi.fn().mockResolvedValue(registration),
    getRegistrations: vi.fn().mockResolvedValue([]),
  });
  return {
    registration,
    container,
    r: { production: true, container, loaded: () => [] } as unknown as Registrar,
  };
}

test('a dev server registers nothing and removes a worker left at its address', async () => {
  const unregister = vi.fn();
  const deleted = vi.fn();
  vi.stubGlobal('caches', { keys: async () => ['browsercol-abc', 'other'], delete: deleted });
  const b = browser(null, null);
  b.container.getRegistrations.mockResolvedValue([{ unregister }]);
  await registerServiceWorker(vi.fn(), { ...b.r, production: false });
  expect(b.container.register).not.toHaveBeenCalled();
  expect(unregister).toHaveBeenCalled();
  expect(deleted.mock.calls).toEqual([['browsercol-abc']]);
  vi.unstubAllGlobals();
});

test('a built site registers sw.js relative to the page', async () => {
  const b = browser(null, null);
  await registerServiceWorker(vi.fn(), b.r);
  expect(b.container.register).toHaveBeenCalledWith('./sw.js');
});

test('a new build waiting under a running one is offered, and Restart tells it to take over', async () => {
  const worker = { postMessage: vi.fn() };
  const b = browser({}, worker);
  const offer = vi.fn();
  await registerServiceWorker(offer, b.r);
  expect(offer).toHaveBeenCalledTimes(1);
  expect(worker.postMessage).not.toHaveBeenCalled();
  offer.mock.calls[0]![0]();
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
});

test('the first install is not offered as a new version', async () => {
  const b = browser(null, { postMessage: vi.fn() });
  const offer = vi.fn();
  await registerServiceWorker(offer, b.r);
  expect(offer).not.toHaveBeenCalled();
});

test('a build that finishes installing later is offered', async () => {
  const b = browser({}, null);
  const offer = vi.fn();
  await registerServiceWorker(offer, b.r);
  const worker = Object.assign(new EventTarget(), { state: 'installing', postMessage: vi.fn() });
  b.registration.installing = worker;
  b.registration.dispatchEvent(new Event('updatefound'));
  worker.state = 'installed';
  worker.dispatchEvent(new Event('statechange'));
  expect(offer).toHaveBeenCalledTimes(1);
});

test('on a first visit, what the page loaded goes through the worker once it takes over', async () => {
  const fetched = vi.fn().mockResolvedValue(new Response());
  vi.stubGlobal('fetch', fetched);
  const b = browser(null, null);
  await registerServiceWorker(vi.fn(), {
    ...b.r,
    loaded: () => ['https://x/play/strings/FreeColMessages_de.properties'],
  });
  b.container.dispatchEvent(new Event('controllerchange'));
  expect(fetched.mock.calls).toEqual([['https://x/play/strings/FreeColMessages_de.properties']]);
  vi.unstubAllGlobals();
});

test('a page a worker already ran loads nothing again when a new build takes over', async () => {
  const fetched = vi.fn();
  vi.stubGlobal('fetch', fetched);
  vi.stubGlobal('location', { reload: vi.fn() });
  const b = browser({}, null);
  await registerServiceWorker(vi.fn(), { ...b.r, loaded: () => ['https://x/play/a.ogg'] });
  b.container.dispatchEvent(new Event('controllerchange'));
  expect(fetched).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test('the prompt says a new version is ready and Restart restarts', () => {
  const restart = vi.fn();
  render(<UpdatePrompt onRestart={restart} />);
  expect(screen.getByRole('status').textContent).toContain('A new version is ready');
  fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
  expect(restart).toHaveBeenCalled();
});

test('the theme colour follows the menu bar token', () => {
  document.documentElement.style.setProperty('--menubar', '#0b0b0c');
  syncThemeColor();
  expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe('#0b0b0c');
  document.documentElement.style.setProperty('--menubar', '#3b2a17');
  syncThemeColor();
  expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe('#3b2a17');
});
