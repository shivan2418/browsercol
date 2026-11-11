import { describe, expect, it, vi } from 'vite-plus/test';
import { waterField, type WaterField } from './map-water';
import type { MapView } from './tileset';
import { fieldMaker, latest } from './water-field-client';
import type { FieldReply, FieldRequest } from './water-field.worker';

const map: Pick<MapView, 'w' | 'h' | 'types' | 'tiles' | 'rivers'> = {
  w: 4,
  h: 4,
  types: [
    { id: 'model.tile.plains', land: true, forested: false, name: 'Plains' },
    { id: 'model.tile.ocean', land: false, forested: false, name: 'Ocean' },
  ],
  tiles: 'ABBB' + 'BABB' + 'BBBB' + 'BBBA',
  rivers: [],
};
const field = (tag: number): WaterField => ({
  cols: 1,
  rows: 1,
  texel: 8,
  texelY: 4,
  data: new Uint8Array([tag, 0, 0, 0]),
  climate: new Uint8Array(4),
});

/** A worker that answers each request as `answer` says: a reply, or failing. */
function fakeWorker(answer: (r: FieldRequest) => FieldReply | 'fail') {
  const posted: FieldRequest[] = [];
  const worker = {
    onmessage: null as ((e: MessageEvent<FieldReply>) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    terminate: vi.fn(),
    postMessage(r: FieldRequest) {
      posted.push(r);
      queueMicrotask(() => {
        const a = answer(r);
        if (a === 'fail') worker.onerror?.({ message: 'boom' } as ErrorEvent);
        else worker.onmessage?.({ data: a } as MessageEvent<FieldReply>);
      });
    },
  };
  return { worker: worker as unknown as Worker, posted, terminate: worker.terminate };
}

describe('fieldMaker', () => {
  it('makes the field in the worker, handing each shore cover over once', async () => {
    const { worker, posted } = fakeWorker(() => ({ field: field(posted.length) }));
    const spawn = vi.fn(() => worker);
    const fields = fieldMaker(spawn);
    const sand = new Float32Array([1]);
    const first = await fields.make(map, 8, new Map([[1, sand]]), 3, null);
    expect(first.data[0]).toBe(1);
    const second = await fields.make(
      map,
      8,
      new Map([
        [1, sand],
        [6, sand],
      ]),
      3,
      first,
    );
    expect(second.data[0]).toBe(2);
    expect(spawn).toHaveBeenCalledTimes(1);
    // A fresh field the first time, then one the worker patches.
    expect(posted.map((r) => r.reset)).toEqual([true, false]);
    expect(posted[0].newCovers).toEqual([[1, sand]]);
    // The same cover again, on two tiles: sent by its id alone.
    expect(posted[1].newCovers).toEqual([]);
    expect(posted[1].covers).toEqual([
      [1, 1],
      [6, 1],
    ]);
    expect(posted[1].climateBlend).toBe(3);
  });

  it('keeps the last field when the worker says nothing changed', async () => {
    const { worker } = fakeWorker(() => ({ field: null }));
    const last = field(7);
    expect(await fieldMaker(() => worker).make(map, 8, new Map(), 3, last)).toBe(last);
  });

  it('makes the field on the page from then on when the worker fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { worker, posted, terminate } = fakeWorker(() => 'fail');
      const fields = fieldMaker(() => worker);
      const made = await fields.make(map, 8, new Map(), 3, field(1));
      expect([...made.data]).toEqual([...waterField(map, 8, () => 0, null, 3).data]);
      expect(terminate).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      await fields.make(map, 8, new Map(), 3, made);
      expect(posted.length).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('makes the field on the page where the browser starts no worker', async () => {
    const fields = fieldMaker(() => {
      throw new Error('no workers here');
    });
    const made = await fields.make(map, 8, new Map(), 3, null);
    expect([...made.data]).toEqual([...waterField(map, 8, () => 0, null, 3).data]);
  });
});

describe('latest', () => {
  it('runs one at a time, and of the values given meanwhile only the last', async () => {
    const done: number[] = [];
    let release!: () => void;
    const run = latest(async (n: number) => {
      if (n === 1) await new Promise<void>((ok) => (release = ok));
      done.push(n);
    });
    const a = run(1);
    const b = run(2);
    const c = run(3);
    expect(b).toBe(a);
    release();
    await c;
    expect(done).toEqual([1, 3]);
    // Idle again: the next value runs at once.
    await run(4);
    expect(done).toEqual([1, 3, 4]);
  });
});
