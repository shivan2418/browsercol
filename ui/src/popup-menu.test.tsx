// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { WindowFrame } from './frame';
import {
  ContextMenuContext,
  PopupMenu,
  clampMenu,
  parseMenu,
  useContextMenu,
  type ContextMenus,
  type MenuData,
  type Popup,
} from './popup-menu';

afterEach(cleanup);

const menu: MenuData = {
  title: 'Tile (3, 4)',
  entries: [
    { id: 'goto:3,4', label: 'Go To This Tile', enabled: true },
    { id: 'none', label: 'Plains', enabled: false, gap: true },
    { id: 'select:unit:1', label: 'Soldier', enabled: true, gap: true },
  ],
};
const popup: Popup = { menu, x: 10, y: 20 };

describe('parseMenu and clampMenu', () => {
  it('reads null as no menu', () => {
    expect(parseMenu('null')).toBeNull();
    expect(parseMenu(JSON.stringify(menu))).toEqual(menu);
  });
  it('keeps a menu inside the viewport', () => {
    expect(clampMenu([10, 20], [100, 50], [800, 600])).toEqual([10, 20]);
    expect(clampMenu([790, 590], [100, 50], [800, 600])).toEqual([700, 550]);
    expect(clampMenu([5, 5], [900, 700], [800, 600])).toEqual([0, 0]);
  });
});

describe('PopupMenu', () => {
  it('shows the entries, the disabled one greyed', () => {
    render(<PopupMenu popup={popup} run={() => {}} close={() => {}} />);
    const m = screen.getByRole('menu', { name: 'Tile (3, 4)' });
    expect(m.getAttribute('style')).toContain('left: 10px');
    expect(screen.getAllByRole('menuitem').map((e) => e.textContent)).toEqual(['Go To This Tile', 'Plains', 'Soldier']);
    expect((screen.getByRole('menuitem', { name: 'Plains' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("draws an entry's icon before its label, when the art has it", () => {
    const work: Popup = {
      menu: {
        title: 'Farmer',
        entries: [{ id: 'work:1', label: 'Work as Farmer', enabled: true, icon: 'image.icon.goods' }],
      },
      x: 0,
      y: 0,
    };
    const art = (keys: readonly string[]) => (keys[0] === 'image.icon.goods' ? 'art/grain.png' : null);
    render(<PopupMenu popup={work} run={() => {}} close={() => {}} art={art} />);
    const item = screen.getByRole('menuitem', { name: 'Work as Farmer' });
    expect(item.firstElementChild?.getAttribute('src')).toBe('art/grain.png');
    expect(item.firstChild).toBe(item.querySelector('img'));
  });

  it('closes, then runs the entry that was picked', () => {
    const log: string[] = [];
    render(<PopupMenu popup={popup} run={(id) => log.push(`run ${id}`)} close={() => log.push('close')} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Soldier' }));
    expect(log).toEqual(['close', 'run select:unit:1']);
  });

  it('closes on Escape, keeping the key from a dialog under it', () => {
    let closed = 0;
    const seen: string[] = [];
    const below = (e: KeyboardEvent) => seen.push(e.key);
    addEventListener('keydown', below);
    render(<PopupMenu popup={popup} run={() => {}} close={() => closed++} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    removeEventListener('keydown', below);
    expect(closed).toBe(1);
    expect(seen).toEqual([]);
  });

  it('closes before the window under it on Escape, and the window on the next', () => {
    const log: string[] = [];
    render(
      <>
        <WindowFrame title="Colony" close={() => log.push('window')}>
          body
        </WindowFrame>
        <PopupMenu popup={popup} run={() => {}} close={() => log.push('menu')} />
      </>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(log).toEqual(['menu']);
  });

  it('closes on a press elsewhere, not on one inside', () => {
    let closed = 0;
    render(<PopupMenu popup={popup} run={() => {}} close={() => closed++} />);
    act(() => void fireEvent.pointerDown(screen.getByRole('menu')));
    expect(closed).toBe(0);
    act(() => void fireEvent.pointerDown(document.body));
    expect(closed).toBe(1);
  });
});

describe('useContextMenu', () => {
  function Target() {
    const onContextMenu = useContextMenu((m) => m.unit('unit:7'));
    return <span onContextMenu={onContextMenu}>colonist</span>;
  }

  it('opens the menu the Engine gives at the pointer, and cancels the browser menu', () => {
    const shown: unknown[] = [];
    const menus: ContextMenus = {
      unit: (id) => (id === 'unit:7' ? menu : null),
      colonyTile: () => null,
      goods: () => null,
      show: (m, x, y) => shown.push([m.title, x, y]),
    };
    render(
      <ContextMenuContext.Provider value={menus}>
        <Target />
      </ContextMenuContext.Provider>,
    );
    const notCancelled = fireEvent.contextMenu(screen.getByText('colonist'), { clientX: 30, clientY: 40 });
    expect(notCancelled).toBe(false);
    expect(shown).toEqual([['Tile (3, 4)', 30, 40]]);
  });

  it('opens nothing for a colonist with no menu, and without menus does nothing', () => {
    const shown: unknown[] = [];
    const none: ContextMenus = {
      unit: () => null,
      colonyTile: () => null,
      goods: () => null,
      show: () => shown.push(1),
    };
    const { unmount } = render(
      <ContextMenuContext.Provider value={none}>
        <Target />
      </ContextMenuContext.Provider>,
    );
    fireEvent.contextMenu(screen.getByText('colonist'));
    expect(shown).toEqual([]);
    unmount();
    render(<Target />);
    expect(fireEvent.contextMenu(screen.getByText('colonist'))).toBe(true);
  });
});
