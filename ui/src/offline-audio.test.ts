import { expect, test, vi } from 'vite-plus/test';
import { describe as say, KEEP_ALIVE_MS, megabytes, OfflineAudio, stateFrom, type AudioLink } from './offline-audio';

/** A page with a worker container; `controller` is the worker that controls it, if any. */
function page(controller: { postMessage: ReturnType<typeof vi.fn> } | null, production = true) {
  const container = Object.assign(new EventTarget(), { controller });
  const persist = vi.fn().mockResolvedValue(true);
  const link = { production, container, persist } as unknown as AudioLink;
  return { container, persist, link };
}

const progress = (state: string, done: number, extra = {}) => ({
  type: 'audio-progress',
  state,
  done,
  total: 38,
  bytes: done * 2_450_000,
  totalBytes: 93_000_000,
  failed: 0,
  ...extra,
});

test('a progress message is a state; any other message is not', () => {
  expect(stateFrom(progress('working', 5))).toMatchObject({ status: 'working', done: 5, total: 38 });
  expect(stateFrom({ type: 'skip-waiting' })).toBeUndefined();
  expect(stateFrom(null)).toBeUndefined();
});

test('the control says where the download is, in files and megabytes', () => {
  expect(megabytes(93_000_000)).toBe('93 MB');
  expect(megabytes(400_000)).toBe('0.4 MB');
  expect(say(stateFrom(progress('working', 19))!)).toBe('Downloading: 19 of 38 files, 47 MB of 93 MB.');
  expect(say(stateFrom(progress('done', 38, { bytes: 93_000_000 }))!)).toBe('Saved for offline, 93 MB.');
  expect(say(stateFrom(progress('idle', 30, { failed: 8 }))!)).toContain('8 of 38 files could not be downloaded');
  expect(say(new OfflineAudio().state)).toContain('installed or built site');
});

test('without a worker the control stays unavailable', () => {
  const dev = new OfflineAudio();
  dev.attach(page(null, false).link);
  expect(dev.state.status).toBe('unavailable');
  const uncontrolled = new OfflineAudio();
  uncontrolled.attach(page(null).link);
  expect(uncontrolled.state.status).toBe('unavailable');
  const insecure = new OfflineAudio();
  insecure.attach({ production: true, container: undefined, persist: async () => false });
  expect(insecure.state.status).toBe('unavailable');
});

test('a controlled page asks the worker where the audio is, and shows what it answers', () => {
  const worker = { postMessage: vi.fn() };
  const p = page(worker);
  const audio = new OfflineAudio();
  const changed = vi.fn();
  audio.subscribe(changed);
  audio.attach(p.link);
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'audio-status' });
  expect(audio.state.status).toBe('idle');
  p.container.dispatchEvent(Object.assign(new Event('message'), { data: progress('done', 38) }));
  expect(audio.state).toMatchObject({ status: 'done', done: 38 });
  expect(changed).toHaveBeenCalled();
});

test('a player who chose it has the audio downloaded again on a page load, with no storage request', () => {
  const worker = { postMessage: vi.fn() };
  const p = page(worker);
  const audio = new OfflineAudio();
  audio.want(true);
  audio.attach(p.link);
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cache-audio' });
  expect(p.persist).not.toHaveBeenCalled();
});

test('a worker that takes over later is asked then (a first visit, a new build)', () => {
  const p = page(null);
  const audio = new OfflineAudio();
  audio.want(true);
  audio.attach(p.link);
  expect(audio.state.status).toBe('unavailable');
  const worker = { postMessage: vi.fn() };
  p.container.controller = worker as never;
  p.container.dispatchEvent(new Event('controllerchange'));
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cache-audio' });
  expect(audio.state.status).toBe('idle');
});

test('opting in starts the download and asks for persistent storage; opting out drops the files', () => {
  const worker = { postMessage: vi.fn() };
  const p = page(worker);
  const audio = new OfflineAudio();
  audio.attach(p.link);
  audio.want(true, true);
  expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'cache-audio' });
  expect(p.persist).toHaveBeenCalledTimes(1);
  audio.want(false, true);
  expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'drop-audio' });
  expect(p.persist).toHaveBeenCalledTimes(1);
});

test('while a download is under way the page asks the worker again, so a stopped worker picks it up', () => {
  vi.useFakeTimers();
  const worker = { postMessage: vi.fn() };
  const audio = new OfflineAudio();
  audio.want(true);
  audio.attach(page(worker).link);
  audio.receive(progress('working', 5));
  worker.postMessage.mockClear();
  vi.advanceTimersByTime(KEEP_ALIVE_MS);
  expect(worker.postMessage.mock.calls).toEqual([[{ type: 'cache-audio' }]]);
  // Done, or given up with failures: no more asking.
  audio.receive(progress('done', 38));
  vi.advanceTimersByTime(KEEP_ALIVE_MS * 3);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
