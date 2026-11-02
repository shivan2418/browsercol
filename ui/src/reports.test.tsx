// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { dialogs } from './dialogs';
import { MENUS, MenuBar, type Art } from './frame';
import { DialogHost } from './panels';
import { ReportContext, reportMenu, type ReportActions } from './reports';
import type { GuiEvents, ReportName, ReportView } from './webgui';

afterEach(cleanup);

const art: Art = (keys) => (keys.includes('image.unit.model.unit.freeColonist') ? 'art/colonist.png' : null);

/** The host with the report links' calls recorded. */
function host() {
  const box = dialogs();
  const calls: string[] = [];
  const actions: ReportActions = {
    open: (name) => calls.push(`open ${name}`),
    detail: (name, id) => calls.push(`detail ${name} ${id}`),
    colony: (id) => calls.push(`colony ${id}`),
    europe: () => calls.push('europe'),
    goTo: (at) => calls.push(`goTo ${at.join(',')}`),
  };
  render(
    <ReportContext.Provider value={actions}>
      <DialogHost
        dialogs={box}
        goTo={() => {}}
        art={art}
        report={{ groupBy: () => {}, filter: () => {}, ignore: () => {} }}
        routes={{ save: () => {}, remove: () => {} }}
      />
    </ReportContext.Provider>,
  );
  return { box, calls };
}

const head = <K extends ReportName>(report: K, back: ReportName | null = null) => ({
  report,
  title: `Title ${report}`,
  ok: 'OK',
  back,
});
const colonist = { id: 'unit:1', name: 'Free Colonist', keys: ['image.unit.model.unit.freeColonist'] };
const food = { type: 'model.goods.food', name: 'Food', keys: [], amount: 3, stock: 40, max: 5 };

const show = (box: ReturnType<typeof host>['box'], e: ReportView) =>
  act(() => box.replace('report', e as GuiEvents['report']));

describe('the Report menu', () => {
  it('opens each report from its entry', () => {
    const opened: string[] = [];
    render(
      <MenuBar
        menus={MENUS.map((name) => ({ name, items: name === 'Report' ? reportMenu((n) => opened.push(n)) : [] }))}
        status=""
      />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Report' }));
    const menu = screen.getByRole('menu', { name: 'Report' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual([
      'Colony report',
      'Labour report',
      'Compact labour report',
      'Military report',
      'Naval report',
      'Cargo report',
      'Education report',
      'Exploration report',
      'History report',
      'Production report',
      'Religion report',
      'Trade report',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Compact labour report' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Report' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Colony report' }));
    expect(opened).toEqual(['compactLabour', 'colony']);
  });
});

describe('the colony report', () => {
  const report: ReportView = {
    ...head('colony'),
    colonies: [
      {
        id: 'colony:7',
        name: 'Jamestown',
        building: { name: 'Hammers', keys: [], unit: false },
        colonists: [colonist],
        outside: [],
        goods: [food],
        buildings: [{ id: 'b:1', name: 'Carpenter', keys: [] }],
      },
    ],
  };

  it('shows each colony with its people and goods, and a click on its name opens the colony panel', () => {
    const { box, calls } = host();
    show(box, report);
    expect(screen.getByRole('dialog', { name: 'Title colony' })).toBeTruthy();
    expect(screen.getByAltText('Free Colonist').getAttribute('src')).toBe('art/colonist.png');
    expect(screen.getByText('+3')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Jamestown' }));
    expect(calls).toEqual(['colony colony:7']);
    // The link closed the report.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes with its button', () => {
    const { box } = host();
    show(box, report);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the labour report', () => {
  const labour: ReportView = {
    ...head('labour'),
    types: [
      { id: 'model.unit.freeColonist', name: 'Free Colonist', keys: [], count: 2 },
      { id: 'model.unit.masterFurTrader', name: 'Master Fur Trader', keys: [], count: 0 },
    ],
  };

  it('opens the details of a kind that there are some of, and not of one with none', () => {
    const { box, calls } = host();
    show(box, labour);
    expect((screen.getByRole('button', { name: /Master Fur Trader/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Free Colonist/ }));
    expect(calls).toEqual(['detail labourDetail model.unit.freeColonist']);
  });

  it('lists where they are, links the colonies, and goes back to the report', () => {
    const { box, calls } = host();
    show(box, {
      ...head('labourDetail', 'labour'),
      unit: { id: 'model.unit.freeColonist', name: 'Free Colonist', keys: [] },
      total: 4,
      colonies: [
        { id: 'colony:7', name: 'Jamestown', count: 1, canTrain: true },
        { id: 'colony:8', name: 'Plymouth', count: 1, canTrain: false },
      ],
      places: [
        { label: 'Europe', count: 1, europe: true, at: null },
        { label: 'Tile 3, 4', count: 1, europe: false, at: [3, 4] },
      ],
      atSea: [],
      canTrain: '* This colony can train units of this type.',
    });
    expect(screen.getByText('This colony can train units of this type.', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Jamestown*' }));
    expect(calls).toEqual(['colony colony:7']);
    show(box, {
      ...head('labourDetail', 'labour'),
      unit: { id: 'u', name: 'Free Colonist', keys: [] },
      total: 1,
      colonies: [],
      places: [{ label: 'Europe', count: 1, europe: true, at: null }],
      atSea: [],
      canTrain: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Europe' }));
    expect(calls.at(-1)).toBe('europe');
    show(box, {
      ...head('labourDetail', 'labour'),
      unit: { id: 'u', name: 'Free Colonist', keys: [] },
      total: 1,
      colonies: [],
      places: [],
      atSea: [{ label: '(At sea)', count: 1 }],
      canTrain: null,
    });
    fireEvent.click(screen.getByRole('button', { name: '◂' }));
    expect(calls.at(-1)).toBe('open labour');
  });
});

describe('the compact labour report', () => {
  const compact: ReportView = {
    ...head('compactLabour'),
    unit: null,
    canTrain: null,
    showProduction: true,
    showNet: true,
    goods: null,
    storedAs: null,
    headers: { unitType: 'Unit Type', workingAs: 'Working As', colonists: 'Colonists', production: 'Production' },
    groups: [
      {
        label: 'All Colonists',
        keys: null,
        link: { kind: 'unit', id: '' },
        summary: { colonists: 2, production: 0, net: 0, hasNet: false },
        rows: [{ unit: null, doing: 'amateurs', count: 2, production: 0, counted: true }],
      },
      {
        label: 'Expert Farmer',
        keys: null,
        link: null,
        summary: { colonists: 0, production: 0, net: 0, hasNet: false },
        rows: [],
      },
    ],
  };

  it('shows the rows of a kind and opens its details from the name', () => {
    const { box, calls } = host();
    show(box, compact);
    expect(screen.getByRole('columnheader', { name: 'Working As' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Production' })).toBeTruthy();
    expect(screen.getByText('amateurs')).toBeTruthy();
    expect(screen.getByText('Expert Farmer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All Colonists' }));
    expect(calls).toEqual(['detail compactLabour ']);
  });
});

describe('the military, naval and cargo reports', () => {
  const unit = { ...colonist, text: 'Free Colonist', goods: [], cargo: [] };
  const units = (report: 'military' | 'naval' | 'cargo'): ReportView => ({
    ...head(report),
    forces: {
      name: 'English forces',
      units: [
        {
          type: 'model.unit.freeColonist',
          name: 'Free Colonist',
          keys: colonist.keys,
          count: 3,
          text: '3 Free Colonist',
        },
      ],
    },
    ref: {
      name: 'Royal Expeditionary Force',
      units: [{ type: 'k', name: 'Regular', keys: [], count: 7, text: '7 Regulars' }],
    },
    none: 'none',
    locations: [
      {
        label: 'Jamestown',
        link: { kind: 'colony', id: 'colony:7', at: [1, 2] },
        units: [
          { ...unit, goods: [{ type: 'model.goods.food', name: 'Food', keys: [], amount: 50 }], cargo: [colonist] },
        ],
      },
      { label: 'Plymouth', link: { kind: 'colony', id: 'colony:8', at: [5, 6] }, units: [] },
      { label: 'Europe', link: { kind: 'europe', id: 'europe:1', at: null }, units: [] },
      { label: 'Tile 3, 4', link: { kind: 'tile', id: 'tile:9', at: [3, 4] }, units: [] },
    ],
  });

  it.each(['military', 'naval', 'cargo'] as const)(
    "shows the %s report: forces, the king's, and each place",
    (name) => {
      const { box } = host();
      show(box, units(name));
      expect(screen.getByRole('dialog', { name: `Title ${name}` })).toBeTruthy();
      expect(screen.getByText('English forces')).toBeTruthy();
      expect(screen.getByText('Royal Expeditionary Force')).toBeTruthy();
      expect(screen.getByText('7')).toBeTruthy();
      expect(screen.getByText('3')).toBeTruthy();
      expect(screen.getByText('50')).toBeTruthy();
      expect(screen.getAllByText('none')).toHaveLength(3);
    },
  );

  it('links each place to its colony, Europe or tile', () => {
    const { box, calls } = host();
    show(box, units('military'));
    fireEvent.click(screen.getByRole('button', { name: 'Jamestown' }));
    show(box, units('military'));
    fireEvent.click(screen.getByRole('button', { name: 'Europe' }));
    show(box, units('military'));
    fireEvent.click(screen.getByRole('button', { name: 'Tile 3, 4' }));
    expect(calls).toEqual(['colony colony:7', 'europe', 'goTo 3,4']);
  });
});

describe('the religion report', () => {
  const report: ReportView = {
    ...head('religion'),
    goods: [
      {
        type: 'model.goods.crosses',
        name: 'Crosses',
        keys: [],
        amount: 0,
        immigration: 12,
        required: 40,
        production: 3,
        colonies: [
          {
            id: 'colony:7',
            name: 'Jamestown',
            building: { id: 'building:1', name: 'Chapel', keys: [] },
            workers: [colonist],
          },
        ],
      },
    ],
  };

  it('shows the crosses so far and the buildings that make them, and a colony name opens its panel', () => {
    const { box, calls } = host();
    show(box, report);
    const section = document.querySelector('[data-goods="model.goods.crosses"]') as HTMLElement;
    expect(within(section).getByText('Crosses')).toBeTruthy();
    expect(section.querySelector('progress')?.getAttribute('value')).toBe('12');
    expect(section.querySelector('progress')?.getAttribute('max')).toBe('40');
    expect(section.querySelector('[data-field="progress"]')?.textContent).toBe('12 / 40 (+3)');
    expect(section.querySelector('[data-list="workers"] img')?.getAttribute('data-unit')).toBe('unit:1');
    fireEvent.click(within(section).getByRole('button', { name: 'Jamestown' }));
    expect(calls).toEqual(['colony colony:7']);
  });
});

describe('the education report', () => {
  const report: ReportView = {
    ...head('education'),
    headers: { teachers: 'Potential teachers', students: 'Potential students' },
    colonies: [
      {
        id: 'colony:7',
        name: 'Jamestown',
        building: { id: 'building:2', name: 'Schoolhouse', keys: [] },
        teachers: [{ ...colonist, id: 'unit:2' }],
        students: [{ ...colonist, learns: 'Carpenter' }],
      },
    ],
  };

  it('lists the teachers and the students of a school, with what a student would learn', () => {
    const { box, calls } = host();
    show(box, report);
    const teachers = document.querySelector('[data-list="teachers"]') as HTMLElement;
    const students = document.querySelector('[data-list="students"]') as HTMLElement;
    expect(within(teachers).getByText('Potential teachers')).toBeTruthy();
    expect(teachers.querySelector('img')?.getAttribute('data-unit')).toBe('unit:2');
    expect(within(students).getByText('Potential students')).toBeTruthy();
    expect(students.querySelector('img')?.getAttribute('title')).toBe('Free Colonist: Carpenter');
    fireEvent.click(screen.getByRole('button', { name: 'Jamestown' }));
    expect(calls).toEqual(['colony colony:7']);
  });
});

describe('the exploration report', () => {
  it('has a row for each region discovered', () => {
    const { box } = host();
    show(box, {
      ...head('exploration'),
      headers: { name: 'Name', type: 'Type', discoveredIn: 'In', discoveredBy: 'By', value: 'Value' },
      regions: [
        { name: 'Bahamas', type: 'Lake', turn: 'Autumn 1492', by: 'Dutch', value: 20 },
        { name: 'Yucatan', type: 'Land', turn: 'Spring 1493', by: 'Dutch', value: 35 },
      ],
    });
    const rows = screen.getAllByRole('row').map((r) => Array.from(r.children).map((c) => c.textContent));
    expect(rows).toEqual([
      ['Name', 'Type', 'In', 'By', 'Value'],
      ['Bahamas', 'Lake', 'Autumn 1492', 'Dutch', '20'],
      ['Yucatan', 'Land', 'Spring 1493', 'Dutch', '35'],
    ]);
  });
});

describe('the history report', () => {
  it('lists each event with its turn', () => {
    const { box } = host();
    show(box, {
      ...head('history'),
      events: [
        { turn: 'Autumn 1492', text: 'You founded Jamestown.' },
        { turn: 'Spring 1493', text: 'You declared independence.' },
      ],
    });
    const rows = screen.getAllByRole('row').map((r) => Array.from(r.children).map((c) => c.textContent));
    expect(rows).toEqual([
      ['Autumn 1492', 'You founded Jamestown.'],
      ['Spring 1493', 'You declared independence.'],
    ]);
  });
});

describe('the trade report', () => {
  const report: ReportView = {
    ...head('trade'),
    goods: [
      { type: 'model.goods.food', name: 'Food', keys: [], buy: 5, sell: 4 },
      { type: 'model.goods.sugar', name: 'Sugar', keys: [], buy: 6, sell: 5 },
    ],
    labels: {
      unitsSold: 'Units sold',
      beforeTaxes: 'Before taxes',
      afterTaxes: 'After taxes',
      cargoUnits: 'In ships',
      totalUnits: 'Total',
      totalDelta: 'Change',
      hasCustomHouse: '* has a custom house',
    },
    sold: [10, 0],
    beforeTaxes: [40, 0],
    afterTaxes: [36, 0],
    cargo: [3, 1],
    total: [50, 6],
    delta: [4, -2],
    colonies: [
      {
        id: 'colony:7',
        name: 'Jamestown',
        export: true,
        cells: [
          { amount: 40, production: 5, exported: 100, warning: null },
          { amount: 2, production: -2, exported: null, warning: 'Sugar will run out' },
        ],
      },
    ],
  };

  it('shows the totals by goods and a stock and net production for each colony', () => {
    const { box, calls } = host();
    show(box, report);
    const text = (row: string) =>
      Array.from(document.querySelector(`[data-row="${row}"]`)!.children).map((c) => c.textContent);
    expect(text('unitsSold')).toEqual(['Units sold', '10', '0']);
    expect(text('afterTaxes')).toEqual(['After taxes', '36', '0']);
    expect(text('cargoUnits')).toEqual(['In ships', '3', '1']);
    expect(text('totalUnits')).toEqual(['Total', '50', '6']);
    expect(text('totalDelta')).toEqual(['Change', '+4', '-2']);
    expect(Array.from(document.querySelectorAll('thead th')).map((h) => h.textContent)).toEqual(['4/5', '5/6']);
    const row = document.querySelector('[data-colony="colony:7"]')!;
    expect(Array.from(row.children).map((c) => c.textContent)).toEqual(['Jamestown*', '40+5', '2-2']);
    expect(row.children[2].getAttribute('title')).toBe('Sugar will run out');
    expect(row.children[1].getAttribute('title')).toBe('Food: exported at 100');
    fireEvent.click(screen.getByRole('button', { name: 'Jamestown*' }));
    expect(calls).toEqual(['colony colony:7']);
  });
});

describe('the production report', () => {
  const report: ReportView = {
    ...head('production'),
    labels: { selectGoods: 'Select goods', nothing: 'Nothing', colony: 'Colony' },
    goods: [
      {
        type: 'model.goods.hammers',
        name: 'Hammers',
        keys: [],
        buildings: [{ id: 'model.building.carpenterHouse', name: "Carpenter's House", keys: [] }],
      },
      {
        type: 'model.goods.rum',
        name: 'Rum',
        keys: [],
        buildings: [{ id: 'model.building.rumDistillerHouse', name: "Rum Distiller's House", keys: [] }],
      },
    ],
    colonies: [
      {
        id: 'colony:7',
        name: 'Jamestown',
        cells: [
          { amount: 3, buildings: [[colonist]] },
          { amount: -1, buildings: [null] },
        ],
      },
    ],
  };

  it('shows nothing until goods are picked, then each colony with the units in the buildings', () => {
    const { box, calls } = host();
    show(box, report);
    expect(document.querySelector('table')).toBeNull();
    fireEvent.change(screen.getByLabelText('Select goods 1'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Select goods 2'), { target: { value: '1' } });
    const row = document.querySelector('[data-colony="colony:7"]')!;
    expect(Array.from(row.children).map((c) => c.textContent)).toEqual(['Jamestown', '+3', '', '-1', '']);
    expect(row.querySelector('[data-building="model.building.carpenterHouse"] img')?.getAttribute('data-unit')).toBe(
      'unit:1',
    );
    expect(Array.from(document.querySelectorAll('thead th')).map((h) => h.textContent)).toEqual([
      'Colony',
      'Hammers',
      'Rum',
    ]);
    // Back to Nothing, and the goods leave the table.
    fireEvent.change(screen.getByLabelText('Select goods 2'), { target: { value: '' } });
    expect(Array.from(document.querySelectorAll('thead th')).map((h) => h.textContent)).toEqual(['Colony', 'Hammers']);
    fireEvent.click(screen.getByRole('button', { name: 'Jamestown' }));
    expect(calls).toEqual(['colony colony:7']);
  });
});
