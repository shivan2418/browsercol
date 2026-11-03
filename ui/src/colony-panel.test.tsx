// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { dialogs } from './dialogs';
import { ColonyActions, ColonyTiles, type ColonyMoves, type DrawTiles } from './colony-panel';
import { DialogHost, type Art } from './panels';
import { ContextMenuContext, type ContextMenus } from './popup-menu';
import { colonist, goods, jamestown } from './colony-fixture';
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

function open(colony: ColonyView = jamestown, drawTiles: DrawTiles | null = null) {
  const box = dialogs();
  render(
    <ColonyTiles.Provider value={drawTiles}>
      <DialogHost
        dialogs={box}
        goTo={() => {}}
        art={art}
        report={{ groupBy() {}, filter() {}, ignore() {} }}
        routes={{ save() {}, remove() {}, assign() {} }}
      />
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
    expect(at('colonyTile:21').querySelectorAll('[data-goods="model.goods.grain"] .pile > *')).toHaveLength(3);
    expect(at('colonyTile:11').querySelectorAll('[data-goods="model.goods.cotton"] .pile > *')).toHaveLength(2);
    // Up to 7 an amount is only icons, with no number.
    expect(at('colonyTile:11').querySelector('[data-goods="model.goods.cotton"] .amount')).toBeNull();
    expect(at('colonyTile:22').dataset.ours).toBe('false');
    // TileViewer.displayColonyTile: the tile taken image, native land, and a worker with no occupation chip.
    expect(at('colonyTile:22').querySelector('img.taken')?.getAttribute('src')).toBe('art/taken.png');
    expect(at('colonyTile:02').querySelector('img.natives')?.getAttribute('src')).toBe('art/native.png');
    expect(at('colonyTile:11').querySelector('img.taken')).toBeNull();
    expect(at('colonyTile:21').querySelector('.chip')).toBeNull();
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
    expect(net.querySelectorAll('[data-goods="model.goods.food"] .pile > *')).toHaveLength(4);
    expect(net.querySelector('[data-goods="model.goods.food"] .amount')).toBeNull();
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
    setQueue: (c, types) => calls.push(`queue ${c} ${types.join(',')}`),
    buy: (c) => calls.push(`buy ${c}`),
    warehouse: (c) => calls.push(`warehouse ${c}`),
    board: (u, s) => calls.push(`board ${u} ${s}`),
    leaveShip: (u) => calls.push(`leave ${u}`),
    load: (s, g, a) => calls.push(`load ${s} ${g}${a ? ' ask' : ''}`),
    unload: (s, g, n, a) => calls.push(`unload ${s} ${g} ${n}${a ? ' ask' : ''}`),
  };
  /** A colony of its own each time: the colonist picked stays picked per colony. */
  let n = 100;
  function openMovable() {
    calls.length = 0;
    const box = dialogs();
    render(
      <ColonyActions.Provider value={moves}>
        <DialogHost
          dialogs={box}
          goTo={() => {}}
          art={art}
          report={{ groupBy() {}, filter() {}, ignore() {} }}
          routes={{ save() {}, remove() {}, assign() {} }}
        />
      </ColonyActions.Provider>,
    );
    act(() => box.show('colony', { ...jamestown, id: `colony:${++n}` }));
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
    expect(tileHit('colonyTile:21').getAttribute('draggable')).toBe('true');
    drag('unit:1', building('building:1'));
    drag('unit:2', tileHit('colonyTile:00'));
    drag('unit:1', part('outside'));
    expect(calls).toEqual(['work unit:1 building:1', 'work unit:2 colonyTile:00', 'outside unit:1']);
  });

  it('lets a colonist be picked up from anywhere on its tile', () => {
    openMovable();
    const tile = tileHit('colonyTile:21');
    expect(tile.getAttribute('draggable')).toBe('true');
    expect(unit('unit:1').getAttribute('draggable')).toBeNull();
    const dataTransfer = { setData() {}, effectAllowed: '' };
    fireEvent.dragStart(tile, { dataTransfer });
    fireEvent.dragOver(building('building:1'), { dataTransfer });
    fireEvent.drop(building('building:1'), { dataTransfer });
    fireEvent.dragEnd(tile, { dataTransfer });
    expect(calls).toEqual(['work unit:1 building:1']);
    // A tile with no one on it carries nothing.
    expect(tileHit('colonyTile:00').getAttribute('draggable')).toBeNull();
  });

  it('puts a colonist outside only if it works in the colony, and gives the centre tile none', () => {
    openMovable();
    drag('unit:3', part('outside'));
    drag('unit:3', tileHit('colonyTile:11'));
    expect(calls).toEqual([]);
    drag('unit:3', tileHit('colonyTile:21'));
    expect(calls).toEqual(['work unit:3 colonyTile:21']);
  });

  it('picks no colonist by a click, so nothing is outlined and no row of goods opens', () => {
    openMovable();
    for (const el of [unit('unit:1'), unit('unit:2'), tileHit('colonyTile:21')]) fireEvent.click(el);
    expect(document.querySelector('[data-picked=true]')).toBeNull();
    expect(part('work')).toBeNull();
    fireEvent.click(tileHit('colonyTile:00'));
    fireEvent.click(building('building:1'));
    expect(calls).toEqual([]);
  });
});

describe('loading a ship in port in the colony panel', () => {
  const calls: string[] = [];
  const moves: ColonyMoves = {
    work: (u, l) => calls.push(`work ${u} ${l}`),
    putOutside: (u) => calls.push(`outside ${u}`),
    changeWork: () => {},
    setQueue: () => {},
    buy: () => {},
    warehouse: () => {},
    board: (u, s) => calls.push(`board ${u} ${s}`),
    leaveShip: (u) => calls.push(`leave ${u}`),
    load: (s, g, a) => calls.push(`load ${s} ${g}${a ? ' ask' : ''}`),
    unload: (s, g, n, a) => calls.push(`unload ${s} ${g} ${n}${a ? ' ask' : ''}`),
  };
  const caravel = {
    id: 'unit:9',
    name: 'Caravel',
    keys: ['image.unit.model.unit.caravel'],
    cargo: {
      title: 'Caravel (0 holds left)',
      units: [colonist('unit:8')],
      goods: [goods('cloth', 100), goods('cloth', 30)],
    },
  };
  const port = { ...jamestown.inPort, units: [caravel], selected: caravel.id };
  let n = 300;
  function openPort(colony: Partial<ColonyView> = { inPort: port }) {
    calls.length = 0;
    const box = dialogs();
    render(
      <ColonyActions.Provider value={moves}>
        <DialogHost
          dialogs={box}
          goTo={() => {}}
          art={art}
          report={{ groupBy() {}, filter() {}, ignore() {} }}
          routes={{ save() {}, remove() {}, assign() {} }}
        />
      </ColonyActions.Provider>,
    );
    act(() => box.show('colony', { ...jamestown, id: `colony:${++n}`, ...colony }));
    return box;
  }
  const unit = (id: string) => document.querySelector<HTMLElement>(`[data-unit="${id}"]`)!;
  const stored = (type: string) => part('warehouse').querySelector<HTMLElement>(`[data-goods="model.goods.${type}"]`)!;
  const stacks = () => [...part('cargo').querySelectorAll<HTMLElement>('[data-goods]')];
  /** A drag as a browser sends it: the press, then the drag. FreeCol reads shift from the press. */
  const drag = (what: HTMLElement, onto: HTMLElement, shiftKey = false) => {
    const dataTransfer = { setData() {}, effectAllowed: '' };
    fireEvent.mouseDown(what, { shiftKey });
    fireEvent.dragStart(what, { dataTransfer });
    fireEvent.dragOver(onto, { dataTransfer });
    fireEvent.drop(onto, { dataTransfer });
    fireEvent.dragEnd(what, { dataTransfer });
  };

  it('puts a unit beside the colony aboard the ship chosen, and takes one off it', () => {
    openPort();
    drag(unit('unit:3'), part('cargo'));
    drag(unit('unit:8'), part('outside'));
    expect(calls).toEqual(['board unit:3 unit:9', 'leave unit:8']);
  });

  it('puts a colonist working in the colony aboard too, and not one already aboard', () => {
    openPort();
    drag(unit('unit:1'), part('cargo'));
    drag(unit('unit:8'), part('cargo'));
    expect(calls).toEqual(['board unit:1 unit:9']);
  });

  it('loads goods dragged from the warehouse, asking the amount on a shift-drag', () => {
    openPort();
    expect(stored('lumber').getAttribute('draggable')).toBe('true');
    drag(stored('lumber'), part('cargo'));
    drag(stored('lumber'), part('cargo'), true);
    expect(calls).toEqual(['load unit:9 model.goods.lumber', 'load unit:9 model.goods.lumber ask']);
  });

  it('cannot move an empty stack of the warehouse, which it shows greyed', () => {
    openPort({
      inPort: port,
      warehouse: {
        ...jamestown.warehouse,
        goods: [
          { ...goods('lumber', 50), over: false },
          { ...goods('cotton', 0), over: false },
        ],
      },
    });
    expect(stored('cotton').querySelector('[data-sign="zero"]')).not.toBeNull();
    expect(stored('cotton').hasAttribute('draggable')).toBe(false);
    drag(stored('cotton'), part('cargo'));
    fireEvent.click(stored('cotton'));
    expect(stored('cotton').dataset.picked).toBeUndefined();
    fireEvent.click(part('cargo'));
    expect(calls).toEqual([]);
  });

  it('puts down goods picked from the warehouse when it has none of them left', () => {
    const box = openPort();
    fireEvent.click(stored('lumber'));
    act(() =>
      box.replace(
        'colony',
        {
          ...box.shown('colony')[0],
          warehouse: { ...jamestown.warehouse, goods: [{ ...goods('lumber', 0), over: false }] },
        },
        () => true,
      ),
    );
    fireEvent.click(part('cargo'));
    expect(calls).toEqual([]);
  });

  it('unloads the stack of cargo dragged into the warehouse, asking the amount on a shift-drag', () => {
    openPort();
    expect(stacks().map((g) => g.querySelector('.amount')?.textContent)).toEqual(['100', '30']);
    drag(stacks()[1], part('warehouse'));
    drag(stacks()[0], part('warehouse'), true);
    expect(calls).toEqual(['unload unit:9 model.goods.cloth 30', 'unload unit:9 model.goods.cloth 100 ask']);
  });

  it('moves goods picked by a click to the box clicked next', () => {
    openPort();
    fireEvent.click(stored('lumber'));
    expect(stored('lumber').dataset.picked).toBe('true');
    fireEvent.click(part('cargo'));
    fireEvent.click(stacks()[0], { shiftKey: true });
    fireEvent.click(part('warehouse'));
    expect(calls).toEqual(['load unit:9 model.goods.lumber', 'unload unit:9 model.goods.cloth 100 ask']);
  });

  it('puts goods nowhere else, and units not in the warehouse', () => {
    openPort();
    drag(stored('lumber'), part('outside'));
    drag(stored('lumber'), document.querySelector<HTMLElement>('[data-building="building:1"]')!);
    drag(stacks()[0], part('cargo'));
    drag(unit('unit:3'), part('warehouse'));
    expect(calls).toEqual([]);
  });

  it('loads nothing with no ship in port', () => {
    openPort({});
    drag(stored('lumber'), part('cargo'));
    drag(unit('unit:3'), part('cargo'));
    expect(calls).toEqual([]);
  });
});

describe('the build queue in the colony panel', () => {
  const calls: string[] = [];
  const moves: ColonyMoves = {
    work: () => {},
    putOutside: () => {},
    changeWork: () => {},
    setQueue: (c, types) => calls.push(`queue ${c} ${types.join(',')}`),
    buy: (c) => calls.push(`buy ${c}`),
    warehouse: (c) => calls.push(`warehouse ${c}`),
    board: () => {},
    leaveShip: () => {},
    load: () => {},
    unload: () => {},
  };
  let n = 200;
  function openQueue(colony: Partial<ColonyView> = {}) {
    calls.length = 0;
    const box = dialogs();
    render(
      <ColonyActions.Provider value={moves}>
        <DialogHost
          dialogs={box}
          goTo={() => {}}
          art={art}
          report={{ groupBy() {}, filter() {}, ignore() {} }}
          routes={{ save() {}, remove() {}, assign() {} }}
        />
      </ColonyActions.Provider>,
    );
    act(() => box.show('colony', { ...jamestown, id: `colony:${++n}`, ...colony }));
    fireEvent.click(part('construction'));
    return box;
  }
  const withQueue = (queue: ColonyView['queue']['queue']) => ({ queue: { ...jamestown.queue, queue } });

  it('opens on its button, listing the queue and only what the colony can build', () => {
    openQueue();
    expect(part('queued').querySelector('[data-queued="model.building.warehouse"]')?.textContent).toContain('80');
    expect(part('buildings').querySelector('[data-buildable="model.building.stockade"]')).toBeTruthy();
    expect(part('buildings').querySelector('[data-buildable="model.building.university"]')).toBeNull();
    expect(part('units').querySelector('[data-buildable="model.unit.wagonTrain"]')).toBeTruthy();
  });

  it('shows what the colony cannot build yet, with the reason, behind the show all box', () => {
    openQueue();
    fireEvent.click(screen.getByLabelText('Show all'));
    const university = part('buildings').querySelector<HTMLElement>('[data-buildable="model.building.university"]')!;
    expect(university.textContent).toContain('Requires: College');
    expect(university.querySelector('button')!.disabled).toBe(true);
    fireEvent.click(university.querySelector('button')!);
    expect(calls).toEqual([]);
  });

  it('adds a building or unit at the end of the queue', () => {
    openQueue();
    fireEvent.click(part('buildings').querySelector('[data-buildable="model.building.stockade"] button')!);
    fireEvent.click(part('units').querySelector('[data-buildable="model.unit.wagonTrain"] button')!);
    expect(calls).toEqual([
      `queue colony:${n} model.building.warehouse,model.building.stockade`,
      `queue colony:${n} model.building.warehouse,model.unit.wagonTrain`,
    ]);
  });

  it('moves and removes what is queued', () => {
    const two = [...jamestown.queue.queue, { ...jamestown.queue.buildings[0], required: [goods('hammers', 64)] }];
    openQueue(withQueue(two));
    const row = (type: string) => part('queued').querySelector<HTMLElement>(`[data-queued="${type}"]`)!;
    const button = (type: string, name: string) => within(row(type)).getByRole('button', { name });
    expect(button('model.building.warehouse', 'up').hasAttribute('disabled')).toBe(true);
    fireEvent.click(button('model.building.stockade', 'up'));
    fireEvent.click(button('model.building.warehouse', 'down'));
    fireEvent.click(button('model.building.warehouse', 'remove'));
    expect(calls).toEqual([
      `queue colony:${n} model.building.stockade,model.building.warehouse`,
      `queue colony:${n} model.building.stockade,model.building.warehouse`,
      `queue colony:${n} model.building.stockade`,
    ]);
  });

  it('buys the current build, when the colony can pay', () => {
    openQueue();
    fireEvent.click(screen.getByRole('button', { name: /Buy Warehouse/ }));
    expect(calls).toEqual([`buy colony:${n}`]);
  });

  it('cannot buy when the colony cannot pay, and has no buy button with nothing queued', () => {
    openQueue({ queue: { ...jamestown.queue, buy: { label: 'Buy Warehouse', price: 210, enabled: false } } });
    expect((screen.getByRole('button', { name: /Buy Warehouse/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    openQueue({ queue: { ...jamestown.queue, queue: [], buy: null } });
    expect(screen.queryByRole('button', { name: /Buy/ })).toBeNull();
  });
});

describe('right-clicking in the colony panel', () => {
  const asked: string[] = [];
  const shown: string[] = [];
  const menu = { title: 'Menu', entries: [{ id: 'x', label: 'X', enabled: true }] };
  const menus: ContextMenus = {
    unit: (id) => (asked.push(`unit ${id}`), id === 'unit:3' ? null : menu),
    goods: (at, type, amount) => (asked.push(`goods ${at} ${type} ${amount}`), menu),
    show: (m, x, y) => shown.push(`${m.title} ${x},${y}`),
  };
  const caravel = {
    id: 'unit:9',
    name: 'Caravel',
    keys: ['image.unit.model.unit.caravel'],
    cargo: { title: 'Caravel', units: [], goods: [goods('cloth', 100)] },
  };
  function open(provide: boolean) {
    asked.length = shown.length = 0;
    const box = dialogs();
    const host = (
      <DialogHost
        dialogs={box}
        goTo={() => {}}
        art={art}
        report={{ groupBy() {}, filter() {}, ignore() {} }}
        routes={{ save() {}, remove() {}, assign() {} }}
      />
    );
    render(provide ? <ContextMenuContext.Provider value={menus}>{host}</ContextMenuContext.Provider> : host);
    act(() =>
      box.show('colony', {
        ...jamestown,
        id: 'colony:500',
        inPort: { ...jamestown.inPort, units: [caravel], selected: caravel.id },
      }),
    );
  }
  const rightClick = (el: Element) => fireEvent.contextMenu(el, { clientX: 70, clientY: 80 });

  it("asks the Engine for a colonist's, a ship's and goods' menu and shows it at the pointer", () => {
    open(true);
    rightClick(document.querySelector('[data-unit="unit:3"]')!);
    expect(shown).toEqual([]);
    rightClick(document.querySelector('[data-unit="unit:2"]')!);
    rightClick(document.querySelector('button.ship[data-unit="unit:9"]')!);
    rightClick(document.querySelector('[data-part="warehouse"] [data-goods="model.goods.lumber"]')!);
    rightClick(document.querySelector('[data-part="cargo"] [data-goods="model.goods.cloth"]')!);
    expect(asked).toEqual([
      'unit unit:3',
      'unit unit:2',
      'unit unit:9',
      'goods colony:500 model.goods.lumber 150',
      'goods unit:9 model.goods.cloth 100',
    ]);
    expect(shown).toEqual(['Menu 70,80', 'Menu 70,80', 'Menu 70,80', 'Menu 70,80']);
  });

  it('keeps the browser menu off, and opens none, without the Engine', () => {
    open(false);
    expect(rightClick(document.querySelector('[data-unit="unit:2"]')!)).toBe(true);
    expect(shown).toEqual([]);
  });
});
