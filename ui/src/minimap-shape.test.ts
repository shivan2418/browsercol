import { afterEach, expect, it } from 'vite-plus/test';
import { imageSize, placement, pointAt, tileSize } from './minimap';
import { projection, setMapShape } from './projection';

// An Isometric shaped map (#559) of 4 tiles across and 7 half rows: a box of 7 by 7, laid out in the Isometric view as
// a rectangle, which the minimap's image is too.
const m = { w: 7, h: 7 };
afterEach(() => setMapShape(null));

it("makes the minimap's image the rectangle, the size of the map's own at the minimap's scale", () => {
  setMapShape({ kind: 'isometric', rows: 7 });
  const size = tileSize(1);
  const [w, h] = imageSize(m, size);
  const [mw, mh] = projection.mapSize(m.w, m.h);
  expect([w, h]).toEqual([(mw * size) / 128, (mh * size) / 128]);
  expect([w, h]).toEqual([(4 * 128 + 64) / 32, 256 / 32]);
});

it('puts every tile of the diamond inside the image, and a click on a tile finds the map point of its middle', () => {
  setMapShape({ kind: 'isometric', rows: 7 });
  const size = tileSize(2);
  const [w, h] = imageSize(m, size);
  const box: [number, number] = [224, 160];
  const view = { centre: [200, 100] as [number, number], viewport: [800, 600] as [number, number], zoom: 1 };
  const { image } = placement(view, box, size);
  const s = size / 128;
  let seen = 0;
  projection.eachTile(m.w, m.h, (x, y) => {
    seen++;
    const [ox, oy] = projection.origin(x, y, m.h).map((c) => (c * size) / 128) as [number, number];
    expect(ox).toBeGreaterThanOrEqual(0);
    expect(oy).toBeGreaterThanOrEqual(0);
    expect(ox + size).toBeLessThanOrEqual(w + 1e-9);
    expect(oy + size / 2).toBeLessThanOrEqual(h + 1e-9);
    // The minimap pixel of the tile's middle, in the box, and the map point a click there gives.
    const [cx, cy] = projection.centre(x, y, m.h);
    const click: [number, number] = [image[0] + cx * s, image[1] + cy * s];
    const [mx, my] = pointAt(view, box, size, click);
    expect(mx).toBeCloseTo(cx);
    expect(my).toBeCloseTo(cy);
    expect(projection.tileAt(m.w, m.h, mx, my)).toEqual([x, y]);
  });
  expect(seen).toBe(28);
});

it("shows the view's frame the size of what the map shows", () => {
  setMapShape({ kind: 'isometric', rows: 7 });
  const size = tileSize(1);
  const view = { centre: [300, 100] as [number, number], viewport: [640, 320] as [number, number], zoom: 0.5 };
  const { visible } = placement(view, [224, 160], size);
  expect(visible[2]).toBeCloseTo((640 / 0.5) * (size / 128));
  expect(visible[3]).toBeCloseTo((320 / 0.5) * (size / 128));
  expect([visible[0] + visible[2] / 2, visible[1] + visible[3] / 2]).toEqual([112, 80]);
});
