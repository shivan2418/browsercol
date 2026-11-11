// The shader water's field (#411), made off the main thread: a move that explores a tile by a coast makes the
// shore distance and the climate again round it, tens of milliseconds a slow machine would otherwise drop frames for.
// The worker keeps the last field, so it makes again only round the tiles that changed, and the shore covers it was
// sent, which the page sends each once. Each reply is a copy of the field, handed over without another copy.
import { coverAt, waterField, type WaterField } from './map-water';
import type { MapView } from './tileset';

export interface FieldRequest {
  /** Start afresh: the look changed, or this is the first field. */
  reset: boolean;
  map: Pick<MapView, 'w' | 'h' | 'types' | 'tiles' | 'rivers'>;
  texel: number;
  /** Each covered water tile's index and its cover's id. */
  covers: [number, number][];
  /** The covers this worker has not been sent yet, by id. */
  newCovers: [number, Float32Array][];
  /** The look's climateBlend: how many tiles the land's climates blend over. */
  climateBlend: number;
}

/** The field made, without what it was made from; null when nothing changed. */
export interface FieldReply {
  field: WaterField | null;
}

const covers = new Map<number, Float32Array>();
let last: WaterField | null = null;

self.onmessage = (e: MessageEvent<FieldRequest>) => {
  const r = e.data;
  if (r.reset) last = null;
  for (const [id, a] of r.newCovers) covers.set(id, a);
  const coverOfTile = new Map(r.covers);
  const next = waterField(
    r.map,
    r.texel,
    (x, y, u, v) => {
      const id = coverOfTile.get(y * r.map.w + x);
      const a = id === undefined ? undefined : covers.get(id);
      return a ? coverAt(a, u, v) : 0;
    },
    last,
    r.climateBlend,
  );
  if (next === last) {
    postMessage({ field: null } satisfies FieldReply);
    return;
  }
  last = next;
  // The worker patches its own arrays next time, so the page gets copies.
  const data = next.data.slice();
  const climate = next.climate.slice();
  const field: WaterField = { cols: next.cols, rows: next.rows, texel: next.texel, texelY: next.texelY, data, climate };
  postMessage({ field } satisfies FieldReply, { transfer: [data.buffer, climate.buffer] });
};
