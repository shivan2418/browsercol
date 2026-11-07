// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { dialogs } from './dialogs';
import { MENUS, MenuBar, type Art } from './frame';
import { DialogHost } from './panels';
import { chooseOption } from './select-test';
import { ReportContext, REPORTS, reportMenu, type ReportActions } from './reports';
import { reportForKey } from './report-keys';
import { hint } from './tip-test';
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
    colopedia: (id) => calls.push(`colopedia ${id}`),
    difficulty: () => calls.push('difficulty'),
    goTo: (at) => calls.push(`goTo ${at.join(',')}`),
  };
  render(
    <ReportContext.Provider value={actions}>
      <DialogHost
        dialogs={box}
        goTo={() => {}}
        art={art}
        report={{ groupBy: () => {}, filter: () => {}, ignore: () => {}, open: () => {} }}
        routes={{ save: () => {}, remove: () => {}, assign: () => {} }}
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
        menus={MENUS.map((name) => ({
          name,
          items:
            name === 'Report'
              ? reportMenu(
                  (n) => opened.push(n),
                  () => opened.push('turn'),
                )
              : [],
        }))}
        status=""
      />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Report' }));
    const menu = screen.getByRole('menu', { name: 'Report' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((m) => m.firstChild?.textContent),
    ).toEqual([
      'Colony report',
      'Labour report',
      'Compact labour report',
      'Military report',
      'Naval report',
      'Cargo report',
      'Continental Congress report',
      'Education report',
      'Exploration report',
      'Foreign affairs report',
      'History report',
      'Native affairs report',
      'Production report',
      'Religion report',
      'Requirements report',
      'Trade report',
      'Turn report',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Compact labour report/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Report' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Colony report/ }));
    expect(within(menu).getByRole('menuitem', { name: /^Religion report/ }).textContent).toContain('Shift+F1');
    expect(opened).toEqual(['compactLabour', 'colony']);
    // The turn report is not a report of Commands.showReport but shows this turn's messages again, on Ctrl+Shift+F11.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Report' }));
    const turn = within(screen.getByRole('menu', { name: 'Report' })).getByRole('menuitem', { name: /^Turn report/ });
    expect(turn.textContent).toContain('Ctrl+Shift+F11');
    fireEvent.click(turn);
    expect(opened.at(-1)).toBe('turn');
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

describe('the compact colony report', () => {
  const item = (text: string, tone: 'alarm' | 'warn' | 'plain' | 'export' | 'good', link: string | null = null) => ({
    text,
    tone,
    tip: `tip ${text}`,
    bold: false,
    keys: null,
    link,
  });
  const report: ReportView = {
    ...head('compactColony'),
    columns: [
      { label: 'Colony', tip: 'The list of colonies', keys: null, left: true, dim: false },
      { label: 'U', tip: 'Units', keys: null, left: false, dim: false },
      { label: '', tip: 'Food', keys: ['image.unit.model.unit.freeColonist'], left: false, dim: true },
    ],
    groups: [
      {
        rows: [
          {
            id: 'colony:7',
            cells: [
              { items: [item('Jamestown', 'good', 'colony:7')] },
              { items: [item('3', 'good', 'colony:7')] },
              { items: [item('-2', 'alarm', 'colony:7')] },
            ],
          },
          { id: 'colony:8', cells: [{ items: [item('Plymouth', 'plain', 'colony:8')] }, { items: [] }, { items: [] }] },
        ],
        summary: [{ items: [item('Mainland', 'plain')] }, { items: [item('5', 'good')] }, { items: [] }],
      },
    ],
  };

  it('has a row for each colony and a summary, with the headers above and below', async () => {
    const { box } = host();
    show(box, report);
    expect(screen.getAllByRole('columnheader', { name: 'Colony' })).toHaveLength(2);
    expect(screen.getAllByRole('columnheader', { name: 'U' })).toHaveLength(2);
    expect(screen.getAllByRole('columnheader')[2].getAttribute('data-dim')).toBe('true');
    expect(screen.getAllByAltText('').length).toBeGreaterThan(0);
    const summary = document.querySelector('tr[data-summary]')!;
    expect(summary.textContent).toBe('Mainland5');
    const lost = screen.getByText('-2');
    expect(lost.getAttribute('data-tone')).toBe('alarm');
    expect(await hint(lost)).toBe('tip -2');
  });

  it('opens a colony from its row, closing the report', () => {
    const { box, calls } = host();
    show(box, report);
    fireEvent.click(screen.getByRole('button', { name: 'Plymouth' }));
    expect(calls).toEqual(['colony colony:8']);
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

  it('lists the teachers and the students of a school, with what a student would learn', async () => {
    const { box, calls } = host();
    show(box, report);
    const teachers = document.querySelector('[data-list="teachers"]') as HTMLElement;
    const students = document.querySelector('[data-list="students"]') as HTMLElement;
    expect(within(teachers).getByText('Potential teachers')).toBeTruthy();
    expect(teachers.querySelector('img')?.getAttribute('data-unit')).toBe('unit:2');
    expect(within(students).getByText('Potential students')).toBeTruthy();
    expect(await hint(students.querySelector('img')!)).toBe('Free Colonist: Carpenter');
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

  it('shows the totals by goods and a stock and net production for each colony', async () => {
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
    expect(await hint(row.children[2])).toBe('Sugar will run out');
    expect(await hint(row.children[1])).toBe('Food: exported at 100');
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

  it('shows nothing until goods are picked, then each colony with the units in the buildings', async () => {
    const { box, calls } = host();
    show(box, report);
    expect(document.querySelector('table')).toBeNull();
    await chooseOption(screen.getByLabelText('Select goods 1'), 'Hammers');
    await chooseOption(screen.getByLabelText('Select goods 2'), 'Rum');
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
    await chooseOption(screen.getByLabelText('Select goods 2'), 'Nothing');
    expect(Array.from(document.querySelectorAll('thead th')).map((h) => h.textContent)).toEqual(['Colony', 'Hammers']);
    fireEvent.click(screen.getByRole('button', { name: 'Jamestown' }));
    expect(calls).toEqual(['colony colony:7']);
  });
});

describe('the requirements report', () => {
  const report: ReportView = {
    ...head('requirements'),
    colonies: [
      {
        id: 'colony:7',
        name: 'Jamestown',
        items: [
          { text: 'Jamestown has no Expert Farmer.', colonies: [] },
          {
            text: 'Colonies with a surplus of food:',
            colonies: [
              { id: 'colony:8', name: 'Plymouth', info: ' (3)' },
              { id: 'colony:9', name: 'Salem', info: ' (1)' },
            ],
          },
        ],
        met: null,
      },
      { id: 'colony:8', name: 'Plymouth', items: [], met: 'All requirements are met.' },
    ],
  };

  it('lists the advice of a colony with the colonies it links, and says when there is none', () => {
    const { box, calls } = host();
    show(box, report);
    const jamestown = document.querySelector('section[data-colony="colony:7"]') as HTMLElement;
    expect(Array.from(jamestown.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'Jamestown has no Expert Farmer.',
      'Colonies with a surplus of food: Plymouth (3), Salem (1)',
    ]);
    const plymouth = document.querySelector('section[data-colony="colony:8"]') as HTMLElement;
    expect(plymouth.querySelector('p')?.textContent).toBe('All requirements are met.');
    fireEvent.click(within(jamestown).getByRole('button', { name: 'Salem' }));
    expect(calls).toEqual(['colony colony:9']);
  });
});

describe('the foreign affairs report', () => {
  const labels = {
    stance: 'Stance',
    colonies: 'Colonies',
    units: 'Units',
    military: 'Military',
    naval: 'Naval',
    gold: 'Gold',
    fathers: 'Founding Fathers',
    tax: 'Tax',
    sol: 'Sons of Liberty',
  };
  const nation = {
    stance: 'Peace',
    stanceKind: 'peace',
    colonies: 3,
    units: 12,
    military: 5,
    naval: 2,
    gold: 400,
    keys: [],
  };
  const report: ReportView = {
    ...head('foreign'),
    labels,
    notice: 'Some figures are estimates.',
    nations: [
      { id: 'p:1', name: 'England', ...nation, fathers: 4, tax: 20, sol: 35 },
      { id: 'p:2', name: 'France', ...nation, fathers: null, tax: null, sol: null },
    ],
  };

  it('shows what is known of each nation, and leaves out what we have not learnt', () => {
    const { box } = host();
    show(box, report);
    const fields = (id: string) =>
      Array.from(document.querySelectorAll('tbody tr[data-field]'))
        .map((r) => [r.querySelector('th')?.textContent, r.querySelector(`td[data-nation="${id}"]`)?.textContent])
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}${v}`);
    expect(fields('p:1')).toEqual([
      'StancePeace',
      'Colonies3',
      'Units12',
      'Military5',
      'Naval2',
      'Gold400',
      'Founding Fathers4',
      'Tax20%',
      'Sons of Liberty35%',
    ]);
    expect(fields('p:2')).toEqual(['StancePeace', 'Colonies3', 'Units12', 'Military5', 'Naval2', 'Gold400']);
    expect(screen.getByText('Some figures are estimates.')).toBeTruthy();
    expect(document.querySelector('td[data-stance="peace"]')?.textContent).toBe('Peace');
    expect(document.querySelectorAll('thead th[data-nation]')).toHaveLength(2);
  });
});

describe('the native affairs report', () => {
  const report: ReportView = {
    ...head('indian'),
    labels: {
      chieftain: 'Chieftain',
      kind: 'Settlements',
      settlements: 'Number',
      tension: 'Tension',
      none: 'No known settlements.',
      capital: 'Capital',
      scout: 'Not yet visited by a scout',
      columns: ['Settlement', 'Mission', 'Tension', 'Skill', 'Most hated', 'Trade'],
    },
    tribes: [
      {
        id: 'p:9',
        name: 'Inca',
        keys: [],
        chieftain: 'Huayna',
        kind: 'City',
        settlements: '1 / 4',
        tension: 'Content (Peace)',
        rows: [
          {
            id: 'tile:5',
            at: [5, 6],
            name: 'Cuzco',
            capital: true,
            scout: true,
            mission: { text: 'Jesuit Missionary', keys: [] },
            alarm: 'Wary',
            skill: { text: 'Free Colonist', keys: ['image.unit.model.unit.freeColonist'] },
            hated: 'Dutch',
            wanted: [{ text: 'Food', keys: null }],
          },
        ],
      },
      {
        id: 'p:10',
        name: 'Aztec',
        keys: [],
        chieftain: 'Montezuma',
        kind: 'City',
        settlements: '0 / ?',
        tension: 'Happy (Peace)',
        rows: [],
      },
    ],
  };

  it('shows each tribe and its settlements, and a settlement links to its tile', () => {
    const { box, calls } = host();
    show(box, report);
    const inca = document.querySelector('section[data-tribe="p:9"]') as HTMLElement;
    expect(inca.querySelector('[data-field="settlements"]')?.textContent).toBe('Number1 / 4');
    expect(inca.querySelector('[data-cell="skill"] img')?.getAttribute('src')).toBe('art/colonist.png');
    expect(inca.querySelector('[data-cell="wanted"]')?.textContent).toBe('Food');
    expect(inca.querySelector('[data-cell="hated"]')?.textContent).toBe('Dutch');
    const aztec = document.querySelector('section[data-tribe="p:10"]') as HTMLElement;
    expect(aztec.textContent).toContain('No known settlements.');
    expect(aztec.querySelector('table')).toBeNull();
    const name = inca.querySelector('tr[data-settlement="tile:5"] td') as HTMLElement;
    expect([...name.querySelectorAll('.tag')].map((t) => t.textContent)).toEqual([
      'Capital',
      'Not yet visited by a scout',
    ]);
    fireEvent.click(within(inca).getByRole('button', { name: 'Cuzco' }));
    expect(calls).toEqual(['goTo 5,6']);
  });
});

describe('the Continental Congress report', () => {
  const father = { description: 'Wise', keys: [], kind: 'Political', turn: null };
  const report: ReportView = {
    ...head('congress'),
    labels: { recruiting: 'Recruiting', none: 'None' },
    current: {
      id: 'f:2',
      name: 'Jefferson',
      description: 'Wise',
      keys: [],
      cost: 100,
      liberty: 40,
      bars: [
        {
          type: 'model.goods.bells',
          name: 'Bells',
          keys: [],
          amount: 100,
          needed: 100,
          available: 40,
          produced: 6,
          turns: '(Turns: 10)',
        },
      ],
    },
    fathers: [
      { id: 'f:1', name: 'Franklin', ...father, state: 'elected', status: 'Elected in 1500', turn: '1500' },
      { id: 'f:2', name: 'Jefferson', ...father, state: 'recruiting', status: 'Recruiting' },
      { id: 'f:3', name: 'Paine', ...father, state: 'available', status: 'Available' },
    ],
  };

  it('shows the father being recruited and every father with its state', () => {
    const { box } = host();
    show(box, report);
    // The colony panel's progress bar: 40 bells dark, next turn's 6 lighter after them.
    const bar = document.querySelector('[data-current="f:2"] .need')!;
    expect(bar.textContent).toBe('40+6/100 (Turns: 10)');
    const [now, next] = bar.querySelectorAll<HTMLElement>('i');
    expect(now.style.width).toBe('40%');
    expect(next.style).toMatchObject({ left: '40%', width: '6%' });
    const state = (id: string) => document.querySelector(`[data-father="${id}"]`)?.getAttribute('data-state');
    expect([state('f:1'), state('f:2'), state('f:3')]).toEqual(['elected', 'recruiting', 'available']);
    expect(document.querySelector('[data-father="f:1"] [data-field="status"]')?.textContent).toBe('Elected in 1500');
  });

  it("opens the Colopedia on a father's name, the one being recruited too", () => {
    const { box, calls } = host();
    show(box, report);
    fireEvent.click(within(document.querySelector('[data-father="f:1"]') as HTMLElement).getByText('Franklin'));
    fireEvent.click(within(document.querySelector('[data-current="f:2"]') as HTMLElement).getByText('Jefferson'));
    expect(calls).toEqual(['colopedia f:1', 'colopedia f:2']);
  });

  it('says so when no father is being recruited', () => {
    const { box } = host();
    show(box, { ...report, current: null });
    expect(document.querySelector('[data-section="recruiting"]')?.textContent).toContain('None');
  });
});

describe('the colopedia', () => {
  const report: ReportView = {
    ...head('colopedia'),
    select: null,
    sections: [
      {
        id: 'units',
        name: 'Units',
        entries: [
          {
            id: 'u:1',
            name: 'Free Colonist',
            group: 'Land unit',
            keys: [],
            text: 'A settler.\nHe farms, see [[g:1|food]].',
            facts: [
              { label: 'Movement:', value: '1', refs: [] },
              { label: 'Goods required:', value: '', refs: [{ id: 'g:1', name: 'Food', keys: [], note: '50' }] },
            ],
          },
          { id: 'u:2', name: 'Caravel', group: 'Naval unit', keys: [], text: 'Sails.', facts: [] },
        ],
      },
      {
        id: 'goods',
        name: 'Goods',
        entries: [{ id: 'g:1', name: 'Food', group: null, keys: [], text: 'Eaten.', facts: [] }],
      },
    ],
  };
  const tree = () => within(document.querySelector('.colopedia') as HTMLElement);
  const detail = () => document.querySelector('.colopedia .detail') as HTMLElement;

  it('shows the first entry with its facts and groups the tree under sub-category headings', () => {
    const { box } = host();
    show(box, report);
    expect(detail().querySelector('h3')?.textContent).toBe('Free Colonist');
    expect(detail().textContent).toContain('Movement:1');
    expect(detail().textContent).toContain('Food (50)');
    expect(Array.from(document.querySelectorAll('.tree .group')).map((g) => g.textContent)).toEqual([
      'Land unit',
      'Naval unit',
    ]);
    fireEvent.click(tree().getByRole('button', { name: 'Caravel' }));
    expect(detail().querySelector('h3')?.textContent).toBe('Caravel');
  });

  it('goes to an entry from a link in a fact or a description, even in another section', () => {
    const { box } = host();
    show(box, report);
    fireEvent.click(within(detail()).getByRole('button', { name: 'food' }));
    expect(detail().querySelector('h3')?.textContent).toBe('Food');
    expect(document.querySelector('[data-section="goods"]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the difficulty report from an action link', () => {
    const { box, calls } = host();
    show(box, {
      ...report,
      sections: [
        {
          id: 'concepts',
          name: 'Concepts',
          entries: [
            {
              id: 'c:1',
              name: 'Efficiency',
              group: null,
              keys: [],
              text: 'See the [[action/difficultyAction|difficulty level report]].',
              facts: [],
            },
          ],
        },
      ],
    });
    fireEvent.click(within(detail()).getByRole('button', { name: 'difficulty level report' }));
    expect(calls).toEqual(['difficulty']);
  });

  it('opens on the entry it is told to', () => {
    const { box } = host();
    show(box, { ...report, select: 'g:1' });
    expect(detail().querySelector('h3')?.textContent).toBe('Food');
  });
});

describe('report hotkeys', () => {
  const press = (code: string, mods: { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) =>
    reportForKey({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods });

  it("opens FreeCol's plain F-key reports on Shift+F, and its Shift+F reports on Ctrl+Shift+F", () => {
    expect(press('F1', { shiftKey: true })).toBe('religion');
    expect(press('F3', { shiftKey: true })).toBe('colony');
    expect(press('F1', { shiftKey: true, ctrlKey: true })).toBe('cargo');
    expect(press('F4', { shiftKey: true, ctrlKey: true })).toBe('production');
  });

  it('leaves the plain F keys and other modifiers to the browser', () => {
    expect(press('F3')).toBeNull();
    expect(press('F3', { shiftKey: true, altKey: true })).toBeNull();
    expect(press('KeyB', { shiftKey: true })).toBeNull();
  });

  it('gives every hotkey to one report only', () => {
    const keys = REPORTS.flatMap((r) => (r.key ? [r.key] : []));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
