import { describe, expect, it } from 'vite-plus/test';
import { cursor, initialView, panel, reduce, type MapFacts, type ViewEvent } from './view';

// A 20x40 map, 2624x1312 pixels at zoom 1, in a 640x480 viewport. Tile
// (x, y)'s centre is at (128x + 64 + 64 * (y % 2), 32y + 32).
const facts = (more: Partial<MapFacts> = {}): MapFacts => ({
  w: 20,
  h: 40,
  types: [],
  tiles: '',
  owners: '',
  players: [],
  active: null,
  activeUnit: null,
  ...more,
});
const SIZE: ViewEvent[] = [
  { k: 'map', map: facts() },
  { k: 'resize', width: 640, height: 480 },
];
const play = (...events: ViewEvent[]) => [...SIZE, ...events].reduce(reduce, initialView);

describe('the view', () => {
  it('centres on the active unit when it changes', () => {
    const v = play({ k: 'activeUnit', unit: 'unit:7', tile: 'tile:1', at: [5, 11] });
    expect(v.centre).toEqual([768, 384]);
    expect(v.active).toEqual({ unit: 'unit:7', tile: [5, 11] });
  });

  it('centres on a focus tile but keeps the view on the map, even when the focus comes first', () => {
    expect(play({ k: 'focus', tile: 'tile:2', at: [10, 20] }).centre).toEqual([1344, 672]);
    // reconnectGUI focuses before the first map view: clamp once it comes.
    const first = [{ k: 'focus', tile: 'tile:0', at: [0, 0] } as ViewEvent, ...SIZE].reduce(reduce, initialView);
    expect(first.centre).toEqual([320, 240]);
    expect(play({ k: 'focus', tile: 'tile:3', at: [19, 39] }).centre).toEqual([2624 - 320, 1312 - 240]);
  });

  it('follows the active unit as it moves, by the map views the client Engine sends after', () => {
    const unit = (id: string) => ({ id, label: 'Caravel', moves: '3', cargo: [], path: null });
    const selected = play({ k: 'activeUnit', unit: 'unit:7', tile: 'tile:1', at: [5, 11] });
    const moved = reduce(selected, { k: 'map', map: facts({ active: [6, 11], activeUnit: unit('unit:7') }) });
    expect(moved.active).toEqual({ unit: 'unit:7', tile: [6, 11] });
    expect(moved.centre).toEqual([896, 384]);
    // A map view about another unit is stale: the WebGUI's activeUnit decides.
    const stale = reduce(selected, { k: 'map', map: facts({ active: [1, 1], activeUnit: unit('unit:8') }) });
    expect(stale.active).toEqual(selected.active);
    expect(stale.centre).toEqual(selected.centre);
  });

  it('pans by screen pixels, and zooms about the pointer within its levels', () => {
    const focused = play({ k: 'focus', tile: 'tile:2', at: [10, 20] });
    expect(reduce(focused, { k: 'pan', dx: 100, dy: -40 }).centre).toEqual([1244, 712]);

    // The map point under the viewport's top left, (1024, 432), stays there.
    const zoom = (v: typeof focused, steps: number) => reduce(v, { k: 'zoom', steps, at: [0, 0] });
    const twice = zoom(zoom(focused, 1), 1);
    expect(twice.zoom).toBe(2);
    expect(twice.centre).toEqual([1024 + 160, 432 + 120]);
    expect(reduce(twice, { k: 'pan', dx: 100, dy: 0 }).centre).toEqual([1134, 552]);
    expect(zoom(twice, 1).zoom, 'no further in').toBe(2);

    const out = zoom(zoom(zoom(focused, -1), -1), -1);
    expect(out.zoom).toBe(0.25);
    // 1920 map pixels tall in view, more than the map's 1312: centred.
    expect(out.centre[1]).toBe(656);
  });

  it("puts FreeCol's cursor on the active unit, or on the selected tile in terrain mode", () => {
    const active = play({ k: 'activeUnit', unit: 'unit:7', tile: 'tile:1', at: [5, 11] });
    expect(cursor(active)).toEqual({ at: [5, 11], kind: 'unit' });

    // No units left to move: changeView(fallback tile) selects a tile and
    // keeps the active unit. On screen, the view stays where it is.
    const near = reduce(active, { k: 'selectedTile', tile: 'tile:4', at: [6, 12] });
    expect(cursor(near)).toEqual({ at: [6, 12], kind: 'tile' });
    expect(near.active).toEqual(active.active);
    expect(near.centre).toEqual(active.centre);
    // Off screen, it centres there.
    expect(reduce(active, { k: 'selectedTile', tile: 'tile:5', at: [15, 30] }).centre).toEqual([1984, 992]);

    // End-turn mode: no active unit, no cursor.
    expect(cursor(reduce(near, { k: 'activeUnit', unit: null, tile: null, at: null }))).toBeNull();
  });

  it('shows the active unit and the hovered tile in the info panel, from the latest map view', () => {
    const caravel = {
      id: 'unit:7',
      label: 'Caravel',
      moves: '1 2/3',
      cargo: ['Free Colonist', '100 Food'],
      path: null,
    };
    // A 2x2 corner: plains owned by the Arawaks, ocean, and two unexplored.
    const map = facts({
      w: 2,
      h: 2,
      types: [
        { id: 'model.tile.plains', land: true, forested: false, name: 'Plains' },
        { id: 'model.tile.ocean', land: false, forested: false, name: 'Ocean' },
      ],
      tiles: 'AB..',
      owners: 'A...',
      players: [{ name: 'Arawak nation', rgb: 0x6c3c18 }],
      active: [1, 0],
      activeUnit: caravel,
    });
    const events: ViewEvent[] = [
      { k: 'map', map },
      { k: 'activeUnit', unit: 'unit:7', tile: 'tile:1', at: [1, 0] },
    ];
    const v = events.reduce(reduce, initialView);
    expect(panel(v)).toEqual({
      unit: { label: 'Caravel', moves: '1 2/3', cargo: ['Free Colonist', '100 Food'] },
      tile: null,
    });

    const hover = (at: [number, number] | null) => panel(reduce(v, { k: 'hover', at })).tile;
    expect(hover([0, 0])).toEqual({ name: 'Plains', owner: { name: 'Arawak nation', rgb: 0x6c3c18 } });
    expect(hover([1, 0])).toEqual({ name: 'Ocean', owner: null });
    expect(hover([0, 1]), 'unexplored').toEqual({ name: null, owner: null });
    expect(hover(null)).toBeNull();

    // The WebGUI moved on to another unit before the next map view: show none.
    const next = reduce(v, { k: 'activeUnit', unit: 'unit:8', tile: 'tile:2', at: [0, 0] });
    expect(panel(next).unit).toBeNull();
  });
});
