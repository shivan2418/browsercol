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
    ).toEqual(['Colony report', 'Labour report', 'Compact labour report']);
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
    expect(screen.getByText('amateurs')).toBeTruthy();
    expect(screen.getByText('Expert Farmer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All Colonists' }));
    expect(calls).toEqual(['detail compactLabour ']);
  });
});
