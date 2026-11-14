import { describe, expect, it } from 'vite-plus/test';
import { describeOffline, OfflineStatus, type OfflineContainer } from './offline-status';

function container(controller: object | null) {
  const target = new EventTarget();
  return Object.assign(target, { controller }) as unknown as OfflineContainer & EventTarget;
}
const progress = (state: string, bytes: number, totalBytes = 60_000_000) =>
  new MessageEvent('message', { data: { type: 'offline-progress', state, bytes, totalBytes } });

describe('the offline status', () => {
  it('on a first visit counts the copy being saved, then says it is ready', () => {
    const s = new OfflineStatus();
    const c = container(null);
    s.attach(c);
    expect(s.progress.state).toBe('unavailable');
    c.dispatchEvent(progress('saving', 27_000_000));
    expect(describeOffline(s.progress)?.label).toBe('Saving for offline 45%');
    expect(describeOffline(s.progress)?.tip).toContain('(60 MB)');
    c.dispatchEvent(progress('saved', 60_000_000));
    expect(describeOffline(s.progress)?.label).toBe('Ready offline');
  });

  it('a page a worker runs is ready, and a new build saving is an update, the old copy still there', () => {
    const s = new OfflineStatus();
    const c = container({});
    s.attach(c);
    expect(s.progress.state).toBe('ready');
    c.dispatchEvent(progress('saving', 6_000_000));
    expect(describeOffline(s.progress)?.label).toBe('Saving the new version 10%');
    c.dispatchEvent(progress('failed', 6_000_000));
    expect(s.progress.state).toBe('ready');
  });

  it('a first copy that fails says so', () => {
    const s = new OfflineStatus();
    const c = container(null);
    s.attach(c);
    c.dispatchEvent(progress('failed', 1_000_000));
    expect(describeOffline(s.progress)?.label).toBe('Offline copy failed');
  });

  it('turned off, shows nothing and ignores the worker', () => {
    const s = new OfflineStatus();
    const c = container(null);
    s.attach(c);
    s.off();
    c.dispatchEvent(progress('saving', 1));
    expect(describeOffline(s.progress)).toBeNull();
  });
});
