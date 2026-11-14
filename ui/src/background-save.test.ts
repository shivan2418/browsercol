import { expect, test, vi } from 'vite-plus/test';
import { BACKGROUND_SAVE_GAP_MS, saveInBackground } from './background-save';

function rig(ready = true) {
  const doc = new EventTarget() as EventTarget & { visibilityState: string };
  doc.visibilityState = 'visible';
  const win = new EventTarget();
  const save = vi.fn();
  let t = 1000;
  const stop = saveInBackground(
    { doc, win } as never,
    () => ready,
    save,
    () => t,
  );
  return { doc, win, save, stop, tick: (ms: number) => (t += ms) };
}

test('saves when the page is hidden, not when it is shown', () => {
  const { doc, save } = rig();
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(save).not.toHaveBeenCalled();
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(save).toHaveBeenCalledTimes(1);
});

test('saves on pagehide, once for a hide and a pagehide together', () => {
  const { doc, win, save, tick } = rig();
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('pagehide'));
  expect(save).toHaveBeenCalledTimes(1);
  tick(BACKGROUND_SAVE_GAP_MS);
  win.dispatchEvent(new Event('pagehide'));
  expect(save).toHaveBeenCalledTimes(2);
});

test('saves nothing when there is no game to save', () => {
  const { win, save } = rig(false);
  win.dispatchEvent(new Event('pagehide'));
  expect(save).not.toHaveBeenCalled();
});

test('a save that throws does not break the page, and stop ends the listening', () => {
  const { win, save, stop, tick } = rig();
  save.mockImplementation(() => {
    throw new Error('no');
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  win.dispatchEvent(new Event('pagehide'));
  expect(save).toHaveBeenCalledTimes(1);
  stop();
  tick(BACKGROUND_SAVE_GAP_MS);
  win.dispatchEvent(new Event('pagehide'));
  expect(save).toHaveBeenCalledTimes(1);
});
