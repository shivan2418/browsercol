// The page's side of the water field's worker (water-field.worker.ts, #411): the field of a map is made there where
// the browser runs it, so a move that explores a coast drops no frames on it, and on the page where it does not or
// the worker fails. Each shore cover is sent to the worker once; the worker keeps the last field to patch.
import { coverAt, waterField, type WaterField } from './map-water';
import type { MapView } from './tileset';
import type { FieldReply, FieldRequest } from './water-field.worker';

type FieldMap = Pick<MapView, 'w' | 'h' | 'types' | 'tiles' | 'rivers'>;

/** What makes a map's water field: in a worker where it can, else on the page. */
export interface FieldMaker {
  /**
   * The field of `map`, made again only round the tiles that changed since `last` (null: made afresh). `covers` is
   * each covered water tile's shore cover (coverOf), by tile index. One at a time: the next waits for this one.
   */
  make(
    map: FieldMap,
    texel: number,
    covers: Map<number, Float32Array>,
    climateBlend: number,
    last: WaterField | null,
  ): Promise<WaterField>;
}

const spawnWorker = () => new Worker(new URL('./water-field.worker.ts', import.meta.url), { type: 'module' });

/** A FieldMaker using the worker `spawn` starts on first use, or none when it throws. */
export function fieldMaker(spawn: () => Worker = spawnWorker): FieldMaker {
  let worker: Worker | null | undefined;
  let reply: ((r: FieldReply | null) => void) | null = null;
  const ids = new WeakMap<Float32Array, number>();
  const sent = new Set<number>();
  let nextId = 1;
  const workerNow = (): Worker | null => {
    if (worker !== undefined) return worker;
    try {
      worker = spawn();
      worker.onmessage = (e: MessageEvent<FieldReply>) => reply?.(e.data);
      worker.onerror = (e) => {
        console.warn('the water field worker failed; the field is made on the page', e.message);
        worker?.terminate();
        worker = null;
        reply?.(null);
      };
    } catch {
      worker = null;
    }
    return worker;
  };
  const onPage = (
    map: FieldMap,
    texel: number,
    covers: Map<number, Float32Array>,
    climateBlend: number,
    last: WaterField | null,
  ) =>
    waterField(
      map,
      texel,
      (x, y, u, v) => {
        const a = covers.get(y * map.w + x);
        return a ? coverAt(a, u, v) : 0;
      },
      last,
      climateBlend,
    );
  return {
    async make(map, texel, covers, climateBlend, last) {
      const w = workerNow();
      if (!w) return onPage(map, texel, covers, climateBlend, last);
      const request: FieldRequest = {
        reset: last === null,
        map: { w: map.w, h: map.h, types: map.types, tiles: map.tiles, rivers: map.rivers },
        texel,
        covers: [],
        newCovers: [],
        climateBlend,
      };
      for (const [at, a] of covers) {
        let id = ids.get(a);
        if (id === undefined) ids.set(a, (id = nextId++));
        if (!sent.has(id)) {
          sent.add(id);
          request.newCovers.push([id, a]);
        }
        request.covers.push([at, id]);
      }
      const answer = new Promise<FieldReply | null>((resolve) => (reply = resolve));
      w.postMessage(request);
      const r = await answer;
      reply = null;
      // Nothing changed since the last field: the worker sends none.
      if (r) return r.field ?? last ?? onPage(map, texel, covers, climateBlend, null);
      // The worker failed: from now on the page makes the fields, afresh, as it has none of the worker's.
      sent.clear();
      return onPage(map, texel, covers, climateBlend, null);
    },
  };
}

/**
 * Run `work` on the latest value given, one at a time: values given while it runs wait, and only the last of them is
 * run next. Each call's promise resolves once no value is waiting: the latest given has been done.
 */
export function latest<T>(work: (t: T) => Promise<void>): (t: T) => Promise<void> {
  let wanted: { t: T } | null = null;
  let running: Promise<void> | null = null;
  return (t) => {
    wanted = { t };
    running ??= (async () => {
      try {
        while (wanted) {
          const next = wanted.t;
          wanted = null;
          await work(next);
        }
      } finally {
        running = null;
      }
    })();
    return running;
  };
}
