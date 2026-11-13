// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  Box,
  boycottOf,
  GoodsAmount,
  MENUS,
  MenuBar,
  WindowFrame,
  fitScale,
  frameEffects,
  framePlaces,
  goodsIcons,
  type Art,
} from './frame';

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

  it('does not animate where motion is off', () => {
    const closed: string[] = [];
    render(
      <WindowFrame title="Europe" close={() => closed.push('closed')}>
        body
      </WindowFrame>,
    );
    expect(screen.getByRole('dialog').hasAttribute('data-motion')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(closed).toEqual(['closed']);
  });

  it('fades in and out with motion on, closing once the fade is over and only once', () => {
    vi.useFakeTimers();
    const motion = frameEffects.motion;
    frameEffects.motion = () => true;
    try {
      const closed: string[] = [];
      render(
        <WindowFrame title="Europe" close={() => closed.push('closed')}>
          body
        </WindowFrame>,
      );
      const frame = screen.getByRole('dialog');
      expect(frame.getAttribute('data-motion')).toBe('in');
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      key('Escape');
      expect(frame.getAttribute('data-motion')).toBe('out');
      expect(closed).toEqual([]);
      act(() => void vi.advanceTimersByTime(frameEffects.ms));
      expect(closed).toEqual(['closed']);
    } finally {
      frameEffects.motion = motion;
      vi.useRealTimers();
    }
  });

  it('shows again, with motion on, when its close kept it up', () => {
    vi.useFakeTimers();
    const motion = frameEffects.motion;
    frameEffects.motion = () => true;
    try {
      // The trade route editor's close goes back to the routes, in the same window.
      function Editor() {
        const [editing, setEditing] = useState(true);
        return (
          <WindowFrame title={editing ? 'Edit route' : 'Routes'} close={() => setEditing(false)}>
            body
          </WindowFrame>
        );
      }
      render(<Editor />);
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      const frame = screen.getByRole('dialog');
      expect(frame.getAttribute('data-motion')).toBe('out');
      act(() => void vi.advanceTimersByTime(frameEffects.ms + 1));
      expect(screen.getByRole('dialog', { name: 'Routes' })).toBe(frame);
      expect(frame.getAttribute('data-motion')).toBe('in');
      expect(frame.hasAttribute('inert')).toBe(false);
    } finally {
      frameEffects.motion = motion;
      vi.useRealTimers();
    }
  });

  it('does not fade out when its close only asks', () => {
    const motion = frameEffects.motion;
    frameEffects.motion = () => true;
    try {
      const closed: string[] = [];
      render(
        <WindowFrame title="Jamestown" close={() => closed.push('asked')} closeAsks>
          body
        </WindowFrame>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(closed).toEqual(['asked']);
      expect(screen.getByRole('dialog').getAttribute('data-motion')).toBe('in');
    } finally {
      frameEffects.motion = motion;
    }
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

  it("is marked boycotted only when told so, and then carries FreeCol's hint (GoodsLabel's disabled icon)", () => {
    expect(goods(40).hasAttribute('data-boycotted')).toBe(false);
    const { container } = render(
      <GoodsAmount
        keys={['image.icon.model.goods.food']}
        name="Food"
        amount={40}
        art={art}
        {...boycottOf({ boycotted: true, label: '40 Food (boycotted)' })}
      />,
    );
    expect((container.firstElementChild as HTMLElement).hasAttribute('data-boycotted')).toBe(true);
    expect(boycottOf({})).toEqual({});
  });

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

  it('writes the store first, as the colony report does, with the most that could be made only for a gain', () => {
    const label = (amount: number, stock: number, expert: number) => {
      const { container } = render(
        <GoodsAmount keys={['k']} name="Food" amount={amount} stock={stock} expert={expert} art={art} icons />,
      );
      return (container.lastElementChild as HTMLElement).querySelector('.amount')?.textContent ?? null;
    };
    expect([label(4, 95, 7), label(-40, 160, 0), label(0, 21, 0), label(8, 176, 8), label(2, 0, 2)]).toEqual([
      '95+4/7',
      '160-40',
      '21+0',
      '176+8',
      null,
    ]);
  });

  it('puts the number of a pile over its icons, unsigned for a gain as FreeCol does', () => {
    const pile = (amount: number) => {
      const { container } = render(
        <GoodsAmount keys={['image.icon.model.goods.food']} name="Food" amount={amount} change art={art} icons />,
      );
      return container.lastElementChild as HTMLElement;
    };
    const [gain, loss] = [pile(9), pile(-3)];
    expect(gain.querySelector('.pile > .amount')?.textContent).toBe('9');
    expect(gain.dataset.sign).toBe('gain');
    expect(loss.querySelector('.pile > .amount')?.textContent).toBe('−3');
    expect(loss.dataset.sign).toBe('loss');
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

  it('opens a submenu below its entry, and a pick in it runs and closes the menu', () => {
    const ran: string[] = [];
    render(
      <MenuBar
        menus={[
          {
            name: 'Debug',
            items: [
              {
                label: 'Show Colony Values',
                run: () => {},
                sub: [
                  { label: 'None', run: () => ran.push('none'), checked: true },
                  { label: 'Dutch', run: () => ran.push('dutch'), checked: false },
                ],
              },
            ],
          },
        ]}
        status=""
      />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: /Dutch/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /Show Colony Values/ }));
    expect(screen.getByRole('menuitemcheckbox', { name: /None/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Dutch/ }));
    expect(ran).toEqual(['dutch']);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a menu with Alt and its first letter, as Swing’s mnemonics do', () => {
    render(<MenuBar menus={[{ name: 'Game', items: [{ label: 'Save', run: () => {} }] }]} status="" />);
    fireEvent.keyDown(document.body, { key: 'g', code: 'KeyG', altKey: true });
    expect(screen.getByRole('menu', { name: 'Game' })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'g', code: 'KeyG', altKey: true });
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

  it('opens another menu on hover only while a menu is open', () => {
    render(
      <MenuBar
        menus={[
          { name: 'Game', items: [{ label: 'Save', run: () => {} }] },
          { name: 'View', items: [{ label: 'Zoom', run: () => {} }] },
        ]}
        status=""
      />,
    );
    const game = screen.getByRole('menuitem', { name: 'Game' });
    const view = screen.getByRole('menuitem', { name: 'View' });
    fireEvent.pointerEnter(view);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(game);
    fireEvent.pointerEnter(view);
    expect(screen.getByRole('menu', { name: 'View' })).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'Game' })).toBeNull();
    fireEvent.click(view);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.pointerEnter(game);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(game);
    key('Escape');
    fireEvent.pointerEnter(view);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('a window laid out at fixed sizes fits the screen (#380, #377)', () => {
  const colony = { w: 1184, h: 812 };
  it('keeps the UI scale where the window fits', () => {
    expect(fitScale(colony, { w: 1920, h: 1080 }, 1)).toBe(1);
    expect(fitScale({ w: 530, h: 510 }, { w: 1920, h: 1080 }, 1.25)).toBe(1.25);
  });
  it('scales down to the screen where it would not, its height or its width', () => {
    // 1280x720: the warehouse row would be cut off at 100%.
    const short = fitScale(colony, { w: 1280, h: 720 }, 1)!;
    expect(short).toBeLessThan(1);
    expect(colony.h * short).toBeLessThanOrEqual(720 * 0.96);
    // 200% on a 1536x695 page: the most that fits, below the UI scale.
    const big = fitScale(colony, { w: 1536, h: 695 }, 2)!;
    expect(colony.h * big).toBeLessThanOrEqual(695 * 0.96);
    expect(colony.h * (big + 0.002)).toBeGreaterThan(695 * 0.96);
    const narrow = fitScale(colony, { w: 1000, h: 2000 }, 1)!;
    expect(colony.w * narrow).toBeLessThanOrEqual(1000 * 0.96);
  });
  it('scales a window down again when it grows past the screen after it opened', () => {
    // jsdom lays nothing out: the window's own size and the screen's are stubbed, and ResizeObserver is a stand-in.
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly call: () => void) {}
        observe() {
          observers.push(this.call);
        }
        disconnect() {}
      },
    );
    const size = { w: 1184, h: 600 };
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => size.w);
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => size.h);
    const screenW = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1280);
    const screenH = vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
    try {
      const { container } = render(
        <WindowFrame title="Metropolis" close={null} fit>
          x
        </WindowFrame>,
      );
      const dialog = container.querySelector('[role=dialog]') as HTMLElement;
      // It opens small, before its rows and pictures have come: it fits at 100%.
      expect(dialog.style.getPropertyValue('--fit')).toBe('1');
      // Then it grows to 833px on an 800px screen (the colony panel on build 15): it is scaled down to fit.
      size.h = 833;
      act(() => observers.forEach((o) => o()));
      const grown = Number(dialog.style.getPropertyValue('--fit'));
      expect(grown).toBeLessThan(1);
      expect(833 * grown).toBeLessThanOrEqual(800 * 0.96);
      // Its change of scale moves its own size by a pixel or two: that is not worked out again.
      size.h = 831;
      dialog.style.setProperty('--fit', 'kept');
      act(() => observers.forEach((o) => o()));
      expect(dialog.style.getPropertyValue('--fit')).toBe('kept');
    } finally {
      width.mockRestore();
      height.mockRestore();
      screenW.mockRestore();
      screenH.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it('leaves a window with no layout alone', () => {
    expect(fitScale({ w: 0, h: 0 }, { w: 1280, h: 720 }, 1)).toBeNull();
  });
  it('marks the window, for the stylesheet to scale it', () => {
    const { container } = render(
      <WindowFrame title="Jamestown" close={null} fit>
        x
      </WindowFrame>,
    );
    expect(container.querySelector('[role=dialog]')!.hasAttribute('data-fit')).toBe(true);
    cleanup();
    const plain = render(
      <WindowFrame title="Report" close={null}>
        x
      </WindowFrame>,
    );
    expect(plain.container.querySelector('[role=dialog]')!.hasAttribute('data-fit')).toBe(false);
  });
});
