// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { dialogs } from './dialogs';
import { ColonyActions, ColonyTiles, type ColonyMoves, type DrawTiles } from './colony-panel';
import { DialogHost, type Art } from './panels';
import type { ColonyView } from './webgui';

afterEach(cleanup);

/** The art the Tileset of these tests has. A replaced key's file is what shows. */
const files: Record<string, string> = {
  'image.unit.model.unit.freeColonist': 'art/colonist.png',
  'image.buildingicon.model.building.townHall': 'art/townhall.png',
  'image.buildingicon.model.building.carpenterHouse': 'art/test-carpenter.png',
  'image.icon.model.goods.food': 'art/food.png',
  'image.icon.model.goods.grain': 'art/grain.png',
  'image.icon.model.goods.cotton': 'art/cotton.png',
  'image.icon.model.goods.hammers': 'art/hammers.png',
  'image.icon.model.goods.lumber': 'art/lumber.png',
  'image.tile.model.tile.plains.center': 'art/plains.png',
  'image.buildingicon.model.building.BuildingSite': 'art/site.png',
  'image.icon.coin': 'art/coin.png',
  'image.tile.tileTaken': 'art/taken.png',
  'image.tileitem.nativeLand': 'art/native.png',
  'image.unit.model.unit.caravel': 'art/caravel.png',
};
const art: Art = (keys) => {
  const key = keys.find((k) => k in files);
  return key ? files[key] : null;
};

const colonist = (id: string) => ({
  id,
  name: 'Dutch Free Colonist',
  keys: ['image.unit.model.unit.freeColonist.dutch', 'image.unit.model.unit.freeColonist'],
});
const goods = (type: string, amount: number) => ({
  type: `model.goods.${type}`,
  name: type[0].toUpperCase() + type.slice(1),
  keys: [`image.icon.model.goods.${type}`],
  amount,
});
const tile = (x: number, y: number, more: Partial<ColonyView['tiles'][number]> = {}) => ({
  id: `colonyTile:${x}${y}`,
  pos: [x, y] as [number, number],
  at: [10 + y - x, 20 + x + y] as [number, number],
  name: 'Plains',
  terrain: ['image.tile.model.tile.plains.center'],
  forest: null,
  centre: false,
  ours: true,
  taken: false,
  natives: false,
  workers: [],
  production: [],
  ...more,
});

const jamestown: ColonyView = {
  id: 'colony:1',
  name: 'Jamestown',
  at: [3, 4],
  ok: 'OK',
  population: {
    total: 'Total: 1',
    rebels: 'Rebels: 0',
    royalists: 'Royalists: 1',
    bonus: 'Bonus: 0',
    rebelPercent: 0,
    rebelShield: [],
    royalistShield: [],
  },
  buildings: [
    {
      id: 'building:1',
      type: 'model.building.townHall',
      name: 'Town Hall',
      keys: ['image.buildingicon.model.building.townHall'],
      site: false,
      capacity: 3,
      workers: [],
      production: { ...goods('bells', 1), max: 1 },
      upkeep: null,
    },
    {
      id: 'building:2',
      type: 'model.building.carpenterHouse',
      name: "Carpenter's house",
      keys: ['image.buildingicon.model.building.carpenterHouse'],
      site: false,
      capacity: 3,
      workers: [colonist('unit:2')],
      production: { ...goods('hammers', 3), max: 6 },
      upkeep: 5,
    },
    {
      id: null,
      type: 'model.building.schoolhouse',
      name: 'Schoolhouse',
      keys: ['image.buildingicon.model.building.BuildingSite'],
      site: true,
      capacity: 0,
      workers: [],
      production: null,
      upkeep: null,
    },
  ],
  tiles: [
    tile(0, 0),
    tile(1, 1, { centre: true, production: [goods('grain', 5), goods('cotton', 2)] }),
    tile(2, 1, {
      workers: [
        {
          ...colonist('unit:1'),
          occupation: 'F',
          work: 'model.goods.grain',
          choices: [goods('grain', 3), goods('cotton', 2)],
        },
      ],
      production: [goods('grain', 3)],
    }),
    tile(2, 2, { ours: false, taken: true }),
    tile(0, 2, { natives: true }),
  ],
  production: [goods('food', 4), goods('lumber', -3)],
  warehouse: { title: 'Warehouse', capacity: 100, goods: [{ ...goods('lumber', 150), over: true }] },
  outside: { title: 'Outside Colony', units: [colonist('unit:3')] },
  inPort: { title: 'In Port', units: [], selected: null, cargo: 'Cargo on carrier' },
  construction: {
    type: 'model.building.warehouse',
    name: 'Warehouse',
    keys: ['image.buildingicon.model.building.warehouse'],
    turns: '(Turns to complete: 27)',
    required: [{ ...goods('hammers', 80), needed: 80, available: 20, produced: 3 }],
  },
  nothing: 'Click on the building site to select a building or unit to build.',
};

function open(colony: ColonyView = jamestown, drawTiles: DrawTiles | null = null) {
  const box = dialogs();
  render(
    <ColonyTiles.Provider value={drawTiles}>
      <DialogHost dialogs={box} goTo={() => {}} art={art} report={{ groupBy() {}, filter() {}, ignore() {} }} />
    </ColonyTiles.Provider>,
  );
  act(() => box.show('colony', colony));
  return box;
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)!;

describe('the colony panel', () => {
  it('is titled with the colony and shows its population', () => {
    open();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Jamestown');
    const population = part('population');
    for (const text of ['Total: 1', 'Rebels: 0', 'Royalists: 1', 'Bonus: 0', '0%', '100%']) {
      expect(within(population).getByText(text)).toBeTruthy();
    }
  });

  it('shows each building with its workers and production, its icon from the Tileset', () => {
    open();
    const carpenter = screen.getByTitle("Carpenter's house");
    expect(carpenter.querySelector('img.art')?.getAttribute('src')).toBe('art/test-carpenter.png');
    expect(within(carpenter).getByAltText('Dutch Free Colonist').getAttribute('src')).toBe('art/colonist.png');
    expect(carpenter.querySelector('[data-unit="unit:2"]')).toBeTruthy();
    expect(carpenter.querySelector('[data-goods="model.goods.hammers"]')?.textContent).toBe('3/6');
    expect(carpenter.querySelectorAll('.slot')).toHaveLength(2);
    // BuildingPanel's UpkeepLabel.
    const upkeep = carpenter.querySelector('.upkeep')!;
    expect(upkeep.textContent).toBe('5');
    expect(upkeep.querySelector('img')?.getAttribute('src')).toBe('art/coin.png');
    expect(screen.getByTitle('Town Hall').querySelector('.upkeep')).toBeNull();
  });

  it('shows an empty plot where a kind of building is not built yet', () => {
    open();
    const plot = document.querySelector('[data-site="model.building.schoolhouse"]')!;
    expect(plot.querySelector('img')?.getAttribute('src')).toBe('art/site.png');
    expect(plot.querySelector('.name')).toBeNull();
    expect(plot.querySelectorAll('.slot')).toHaveLength(0);
  });

  it('places the tiles as Swing does and shows who works them and what they make', () => {
    open();
    const tiles = part('tiles');
    const at = (id: string) => tiles.querySelector<HTMLElement>(`[data-tile="${id}"]`)!;
    // TilesPanel: north at the top centre, the centre tile in the middle, west at the left.
    expect([at('colonyTile:00').style.left, at('colonyTile:00').style.top]).toEqual(['128px', '0px']);
    expect([at('colonyTile:11').style.left, at('colonyTile:11').style.top]).toEqual(['128px', '64px']);
    expect([at('colonyTile:21').style.left, at('colonyTile:21').style.top]).toEqual(['64px', '96px']);
    expect(within(at('colonyTile:21')).getByAltText('Dutch Free Colonist')).toBeTruthy();
    expect(at('colonyTile:21').querySelector('[data-goods="model.goods.grain"]')?.textContent).toBe('3');
    expect(at('colonyTile:11').querySelector('[data-goods="model.goods.cotton"]')?.textContent).toBe('2');
    expect(at('colonyTile:22').dataset.ours).toBe('false');
    // TileViewer.displayColonyTile: the tile taken image, native land, and the worker's occupation chip.
    expect(at('colonyTile:22').querySelector('img.taken')?.getAttribute('src')).toBe('art/taken.png');
    expect(at('colonyTile:02').querySelector('img.natives')?.getAttribute('src')).toBe('art/native.png');
    expect(at('colonyTile:11').querySelector('img.taken')).toBeNull();
    expect(at('colonyTile:21').querySelector('.chip')?.textContent).toBe('F');
    // With no map to draw from, each tile shows its terrain image.
    expect(at('colonyTile:11').querySelector('img.terrain')?.getAttribute('src')).toBe('art/plains.png');
  });

  it('draws the tiles as the map draws them, given a drawer, and removes the drawing when it closes', () => {
    const asked: unknown[] = [];
    let removed = 0;
    const box = open(jamestown, (host, centre, tiles, top) => {
      asked.push({ host: host.className, centre, tiles, top });
      return () => removed++;
    });
    expect(asked).toEqual([{ host: 'ground', centre: [10, 22], tiles: jamestown.tiles.map((t) => t.at), top: 32 }]);
    expect(part('tiles').querySelector('img.terrain')).toBeNull();
    act(() => box.current()!.done(undefined as never));
    expect(removed).toBe(1);
  });

  it('shows the net production, the warehouse, the units outside and the build', () => {
    open();
    const net = part('net');
    expect(net.querySelector('[data-goods="model.goods.food"]')?.textContent).toBe('+4');
    expect(net.querySelector('[data-goods="model.goods.lumber"]')?.textContent).toBe('\u22123');
    const lumber = part('warehouse').querySelector<HTMLElement>('[data-goods="model.goods.lumber"]')!;
    expect(lumber.textContent).toBe('150');
    expect(lumber.dataset.over).toBe('true');
    expect(lumber.querySelector('img')?.getAttribute('src')).toBe('art/lumber.png');
    expect(within(part('outside')).getAllByAltText('Dutch Free Colonist')).toHaveLength(1);
    expect(within(part('port')).queryAllByRole('img')).toHaveLength(0);
    expect(within(part('cargo')).getByText('Cargo on carrier')).toBeTruthy();
    const build = part('construction');
    expect(within(build).getByText('Warehouse')).toBeTruthy();
    expect(within(build).getByText('(Turns to complete: 27)')).toBeTruthy();
    expect(within(build).getByText('20+3/80')).toBeTruthy();
    // The captioned boxes are named by the Engine's text.
    expect(screen.getByRole('region', { name: 'Warehouse' })).toBe(part('warehouse'));
  });

  it('shows the cargo of the ship chosen in port, and of another when it is clicked', () => {
    const ship = (id: string, name: string, cargo: ColonyView['inPort']['units'][number]['cargo']) => ({
      id,
      name,
      keys: ['image.unit.model.unit.caravel'],
      cargo,
    });
    const box = open({
      ...jamestown,
      inPort: {
        ...jamestown.inPort,
        units: [
          ship('unit:7', 'Caravel A', {
            title: 'Cargo on Caravel A (1 hold left)',
            units: [colonist('unit:8')],
            goods: [],
          }),
          ship('unit:9', 'Caravel B', {
            title: 'Cargo on Caravel B (1 hold left)',
            units: [],
            goods: [goods('food', 50)],
          }),
        ],
        selected: 'unit:9',
      },
    });
    const cargo = () => part('cargo');
    expect(within(cargo()).getByText('Cargo on Caravel B (1 hold left)')).toBeTruthy();
    expect(cargo().querySelector('[data-goods="model.goods.food"]')?.textContent).toBe('50');
    fireEvent.click(part('port').querySelector('[data-unit="unit:7"]')!);
    expect(within(cargo()).getByText('Cargo on Caravel A (1 hold left)')).toBeTruthy();
    expect(cargo().querySelector('[data-unit="unit:8"]')).toBeTruthy();
    // The choice stays as the panel is shown again.
    act(() => box.replace('colony', box.shown('colony')[0], () => true));
    expect(within(cargo()).getByText('Cargo on Caravel A (1 hold left)')).toBeTruthy();
  });

  it('says so when nothing is built', () => {
    open({ ...jamestown, construction: null });
    expect(within(part('construction')).getByText(jamestown.nothing)).toBeTruthy();
  });

  it('closes on its button and on Escape', () => {
    const box = open();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => box.show('colony', jamestown));
    act(() => void fireEvent.keyDown(window, { key: 'Escape' }));
    expect(box.current()).toBeNull();
  });

  it('shows the colony again in place as it changes', () => {
    const box = open();
    act(() => box.replace('colony', { ...jamestown, name: 'Jamestown (2)' }, (c) => c.id === jamestown.id));
    expect(box.shown('colony').map((c) => c.name)).toEqual(['Jamestown (2)']);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Jamestown (2)');
  });
});

describe('moving colonists in the colony panel', () => {
  const calls: string[] = [];
  const moves: ColonyMoves = {
    work: (u, l) => calls.push(`work ${u} ${l}`),
    putOutside: (u) => calls.push(`outside ${u}`),
    changeWork: (u, g) => calls.push(`change ${u} ${g}`),
  };
  function openMovable() {
    calls.length = 0;
    const box = dialogs();
    render(
      <ColonyActions.Provider value={moves}>
        <DialogHost dialogs={box} goTo={() => {}} art={art} report={{ groupBy() {}, filter() {}, ignore() {} }} />
      </ColonyActions.Provider>,
    );
    act(() => box.show('colony', jamestown));
    return box;
  }
  const unit = (id: string) => document.querySelector<HTMLElement>(`[data-unit="${id}"]`)!;
  const tileHit = (id: string) => document.querySelector<HTMLElement>(`[data-tile="${id}"]`)!;
  const building = (id: string) => document.querySelector<HTMLElement>(`[data-building="${id}"]`)!;
  /** What a browser's drag of a unit onto a place sends. */
  const drag = (id: string, onto: HTMLElement) => {
    const dataTransfer = { setData() {}, effectAllowed: '' };
    fireEvent.dragStart(unit(id), { dataTransfer });
    fireEvent.dragOver(onto, { dataTransfer });
    fireEvent.drop(onto, { dataTransfer });
    fireEvent.dragEnd(unit(id), { dataTransfer });
  };

  it('moves nothing, and makes nothing draggable, without the means to move', () => {
    open();
    expect(unit('unit:1').getAttribute('draggable')).toBeNull();
    fireEvent.click(unit('unit:1'));
    expect(unit('unit:1').dataset.picked).toBeUndefined();
  });

  it('puts a dragged colonist to work in a building or on a tile, or outside the colony', () => {
    openMovable();
    expect(unit('unit:1').getAttribute('draggable')).toBe('true');
    drag('unit:1', building('building:1'));
    drag('unit:2', tileHit('colonyTile:00'));
    drag('unit:1', part('outside'));
    expect(calls).toEqual(['work unit:1 building:1', 'work unit:2 colonyTile:00', 'outside unit:1']);
  });

  it('puts a colonist outside only if it works in the colony, and gives the centre tile none', () => {
    openMovable();
    drag('unit:3', part('outside'));
    drag('unit:3', tileHit('colonyTile:11'));
    expect(calls).toEqual([]);
    drag('unit:3', tileHit('colonyTile:21'));
    expect(calls).toEqual(['work unit:3 colonyTile:21']);
  });

  it('moves a colonist picked by a click to the place clicked next', () => {
    openMovable();
    fireEvent.click(unit('unit:2'));
    expect(unit('unit:2').dataset.picked).toBe('true');
    fireEvent.click(tileHit('colonyTile:00'));
    expect(calls).toEqual(['work unit:2 colonyTile:00']);
    expect(unit('unit:2').dataset.picked).toBe('false');
    // Clicking a place with nothing picked does nothing, and a second click on a unit puts it down.
    fireEvent.click(building('building:1'));
    fireEvent.click(unit('unit:3'));
    fireEvent.click(unit('unit:3'));
    fireEvent.click(building('building:1'));
    expect(calls).toHaveLength(1);
  });

  it('offers the picked colonist the other goods it could make where it works', () => {
    openMovable();
    expect(part('work')).toBeNull();
    fireEvent.click(unit('unit:1'));
    const work = part('work');
    expect(work.querySelector('[data-goods="model.goods.grain"]')?.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(work.querySelector('[data-goods="model.goods.cotton"]')!);
    expect(calls).toEqual(['change unit:1 model.goods.cotton']);
    // One with nothing else to make has no choice to offer.
    fireEvent.click(unit('unit:1'));
    fireEvent.click(unit('unit:2'));
    expect(part('work')).toBeNull();
  });

  it('puts a colonist down when it has left the colony', () => {
    const box = openMovable();
    fireEvent.click(unit('unit:2'));
    act(() =>
      box.replace(
        'colony',
        { ...jamestown, buildings: jamestown.buildings.map((b) => ({ ...b, workers: [] })) },
        () => true,
      ),
    );
    expect(unit('unit:2')).toBeNull();
    fireEvent.click(building('building:1'));
    expect(calls).toEqual([]);
  });
});
