// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { Box, GoodsAmount, MENUS, MenuBar, WindowFrame, framePlaces, goodsIcons, type Art } from './frame';

afterEach(cleanup);

const key = (k: string) => act(() => void fireEvent.keyDown(window, { key: k }));

describe('the window frame', () => {
  it('opens where it was left, by its kind, when the remember panel positions option is on', () => {
    framePlaces.places = { colony: { x: 40, y: -20 } };
    const frame = () => screen.getByRole('dialog', { name: 'Jamestown' }) as HTMLElement;
    const open = () =>
      render(
        <WindowFrame title="Jamestown" close={() => {}} data-kind="colony">
          body
        </WindowFrame>,
      );
    open();
    expect(frame().style.transform).toBe('');
    cleanup();
    framePlaces.remember = true;
    open();
    expect(frame().style.transform).toBe('translate(40px, -20px)');
    framePlaces.remember = false;
  });

  it('has the panel’s name in its title bar, over its body', () => {
    render(
      <WindowFrame title="Jamestown" close={() => {}}>
        <p>Body</p>
      </WindowFrame>,
    );
    const frame = screen.getByRole('dialog', { name: 'Jamestown' });
    expect(within(frame).getByRole('heading').textContent).toBe('Jamestown');
    expect(frame.querySelector('.title')?.nextElementSibling?.textContent).toBe('Body');
  });

  it('closes on its close button or Escape, and keeps Escape from the page', () => {
    const closed: string[] = [];
    let pageSaw = 0;
    const page = () => pageSaw++;
    addEventListener('keydown', page);
    render(
      <WindowFrame title="Europe" close={() => closed.push('closed')}>
        body
      </WindowFrame>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    key('Escape');
    removeEventListener('keydown', page);
    expect(closed).toEqual(['closed', 'closed']);
    expect(pageSaw).toBe(0);
  });

  it('with no close has no close button, and Escape does nothing', () => {
    render(
      <WindowFrame title={null} close={null}>
        body
      </WindowFrame>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    key('Escape');
    screen.getByRole('dialog');
  });

  it('moves with its title bar dragged, and not with its close button', () => {
    render(
      <WindowFrame title="Colony" close={() => {}}>
        body
      </WindowFrame>,
    );
    const frame = screen.getByRole('dialog');
    const bar = frame.querySelector('.title')!;
    fireEvent.pointerDown(bar, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 60, clientY: 40, pointerId: 1 });
    expect(frame.style.transform).toBe('translate(50px, 30px)');
    fireEvent.pointerUp(bar, { pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 200, clientY: 200, pointerId: 1 });
    expect(frame.style.transform, 'it stays where it was dropped').toBe('translate(50px, 30px)');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Close' }), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(bar, { clientX: 300, clientY: 300 });
    expect(frame.style.transform).toBe('translate(50px, 30px)');
  });

  it('gives Escape to the newest frame only', () => {
    const closed: string[] = [];
    const { rerender } = render(
      <WindowFrame title="Colony" close={() => closed.push('colony')}>
        body
      </WindowFrame>,
    );
    rerender(
      <>
        <WindowFrame title="Colony" close={() => closed.push('colony')}>
          body
        </WindowFrame>
        <WindowFrame title="Choice" close={() => closed.push('choice')}>
          body
        </WindowFrame>
      </>,
    );
    key('Escape');
    expect(closed).toEqual(['choice']);
  });

  it('passes its other attributes on', () => {
    render(
      <WindowFrame title="x" close={null} className="dialog" data-kind="confirm" aria-modal="true">
        body
      </WindowFrame>,
    );
    const frame = screen.getByRole('dialog');
    expect(frame.className).toBe('frame dialog');
    expect(frame.dataset.kind).toBe('confirm');
  });
});

describe('the boxed section', () => {
  it('is named by its caption, which comes first', () => {
    render(
      <Box caption="In port">
        <p>No ships in port</p>
      </Box>,
    );
    const box = screen.getByRole('region', { name: 'In port' });
    expect(box.className).toBe('box');
    expect(box.firstElementChild?.className).toBe('cap');
    expect(box.textContent).toBe('In portNo ships in port');
  });
});

describe('the goods amount', () => {
  const art: Art = (keys) => (keys.includes('image.icon.model.goods.food') ? 'art/food.png' : null);
  const goods = (amount: number, change = false, keys = ['image.icon.model.goods.food']) => {
    const { container } = render(<GoodsAmount keys={keys} name="Food" amount={amount} change={change} art={art} />);
    return container.firstElementChild as HTMLElement;
  };

  it('shows the icon for the resource key, and the number', () => {
    const g = goods(40);
    expect(g.querySelector('img')?.getAttribute('src')).toBe('art/food.png');
    expect(g.querySelector('img')?.getAttribute('alt')).toBe('Food');
    expect(g.textContent).toBe('40');
    expect(g.dataset.sign).toBeUndefined();
  });

  it("draws icons and the number as FreeCol's goods image options say", () => {
    const pile = (amount: number) => {
      const { container } = render(
        <GoodsAmount keys={['image.icon.model.goods.food']} name="Food" amount={amount} art={art} icons />,
      );
      const g = container.lastElementChild as HTMLElement;
      return [g.querySelectorAll('.pile img').length, g.querySelector('.amount')?.textContent ?? null];
    };
    expect([pile(6), pile(7), pile(9)]).toEqual([
      [6, null],
      [7, '7'],
      [7, '9'],
    ]);
    Object.assign(goodsIcons, { max: 3, countFrom: 5 });
    expect([pile(2), pile(4), pile(5)]).toEqual([
      [2, null],
      [3, '4'],
      [3, '5'],
    ]);
    Object.assign(goodsIcons, { max: 7, countFrom: 7 });
  });

  it('marks a gain, a loss and a zero', () => {
    expect(
      [goods(3, true), goods(-2, true), goods(0, true), goods(0)].map((g) => [g.textContent, g.dataset.sign]),
    ).toEqual([
      ['+3', 'gain'],
      ['−2', 'loss'],
      ['0', 'zero'],
      ['0', 'zero'],
    ]);
  });

  it('shows the first of its keys the Tileset has', () => {
    const g = goods(1, false, ['image.icon.model.goods.food.dutch', 'image.icon.model.goods.food']);
    expect(g.querySelector('img')?.getAttribute('src')).toBe('art/food.png');
  });

  it('shows the name when the Tileset has no icon', () => {
    const g = goods(5, false, ['image.icon.model.goods.rum']);
    expect(g.querySelector('img')).toBeNull();
    expect(g.textContent).toBe('Food5');
  });
});

describe('the menu bar', () => {
  const statusLine = 'Score: 0    ✧    Gold: 1000    ✧    Tax: 0%    ✧    Year: Spring 1493';

  it('has FreeCol’s menus on the left and the status line on the right', () => {
    render(<MenuBar menus={MENUS.map((name) => ({ name, items: [] }))} status={statusLine} />);
    expect(
      within(screen.getByRole('menubar'))
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['Game', 'View', 'Orders', 'Report', 'Colopedia']);
    const status = screen.getByText('Score: 0 ✧ Gold: 1000 ✧ Tax: 0% ✧ Year: Spring 1493');
    expect(status.id).toBe('statusLine');
    expect(status.textContent).toBe(statusLine);
  });

  it('opens a menu with entries on a click, and runs and closes on a pick', () => {
    const ran: string[] = [];
    render(
      <MenuBar
        menus={[
          { name: 'Game', items: [{ label: 'Save', run: () => ran.push('save') }] },
          { name: 'View', items: [] },
        ]}
        status=""
      />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Game' }));
    const menu = screen.getByRole('menu', { name: 'Game' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Save' }));
    expect(ran).toEqual(['save']);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes an open menu on Escape or a click elsewhere', () => {
    render(<MenuBar menus={[{ name: 'Game', items: [{ label: 'Save', run: () => {} }] }]} status="" />);
    const game = screen.getByRole('menuitem', { name: 'Game' });
    fireEvent.click(game);
    key('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(game);
    act(() => void fireEvent.pointerDown(document.body));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
