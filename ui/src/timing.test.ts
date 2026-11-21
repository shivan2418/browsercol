import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { serveWorker, type Scope } from './channel';
import { fakeSaveStore } from './fake-saves';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the timing probes', () => {
  it('make no performance marks without ?slidetiming', async () => {
    const mark = vi.spyOn(performance, 'mark');
    vi.stubGlobal('location', { search: '' });
    const { slideMark, timingOn } = await import('./timing');
    slideMark('start');
    expect(timingOn).toBe(false);
    expect(mark).not.toHaveBeenCalled();
  });

  it('mark with ?slidetiming', async () => {
    const mark = vi.spyOn(performance, 'mark');
    vi.stubGlobal('location', { search: '?skipstart&slidetiming' });
    const { slideMark, timingOn } = await import('./timing');
    slideMark('start');
    expect(timingOn).toBe(true);
    expect(mark).toHaveBeenCalledWith('slide: start');
  });

  const posted = async (timing: boolean | undefined) => {
    const { port1: page, port2: worker } = new MessageChannel();
    const scope: Scope = {};
    serveWorker(worker, () => new Promise(() => {}), scope, fakeSaveStore(), undefined, timing);
    const got = new Promise<Record<string, unknown>>((ok) => (page.onmessage = (e) => ok(e.data)));
    (scope.fcPost as (xml: string) => void)('<x/>');
    const m = await got;
    page.close();
    worker.close();
    return m;
  };

  it("leaves the Worker's clock off its messages unless timing", async () => {
    expect(await posted(undefined)).toEqual({ k: 'fc', xml: '<x/>' });
    expect(await posted(false)).toEqual({ k: 'fc', xml: '<x/>' });
    expect(typeof (await posted(true)).t).toBe('number');
  });
});
