// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { keepTabOnPage, tabbables } from './focus';
import { MenuBar, WindowFrame } from './frame';
import { PopupMenu } from './popup-menu';

afterEach(cleanup);
keepTabOnPage();

/** Press Tab where the focus is; whether the page took it (the browser's own Tab then does nothing). */
const tab = (shift = false) => !fireEvent.keyDown(document.activeElement ?? window, { key: 'Tab', shiftKey: shift });
const press = (k: string) => act(() => void fireEvent.keyDown(document.activeElement!, { key: k }));
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const focused = () => document.activeElement?.textContent;

describe('Tab on the page', () => {
  it('goes round from the last button to the first, and back with Shift', () => {
    render(
      <div>
        <button>One</button>
        <button disabled>Off</button>
        <button>Two</button>
      </div>,
    );
    button('One').focus();
    expect(tab()).toBe(false);
    button('Two').focus();
    expect(tab()).toBe(true);
    expect(focused()).toBe('One');
    expect(tab(true)).toBe(true);
    expect(focused()).toBe('Two');
  });

  it('is left alone with nothing focused, where the map changes units with it', () => {
    render(<button>One</button>);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(tab()).toBe(false);
  });

  it('skips disabled, hidden and untabbable elements', () => {
    render(
      <div>
        <button>A</button>
        <button disabled>B</button>
        <div hidden>
          <button>C</button>
        </div>
        <span tabIndex={-1}>D</span>
        <span tabIndex={0}>E</span>
      </div>,
    );
    expect(tabbables(document.body).map((e) => e.textContent)).toEqual(['A', 'E']);
  });
});

describe('Tab in a window', () => {
  it('goes round the newest window while the focus is in it', () => {
    render(
      <>
        <button>Page</button>
        <WindowFrame title="Old" close={() => {}}>
          <button>Under</button>
        </WindowFrame>
        <WindowFrame title="New" close={() => {}}>
          <button>Ok</button>
        </WindowFrame>
      </>,
    );
    button('Ok').focus();
    expect(tab()).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
    expect(tab(true)).toBe(true);
    expect(focused()).toBe('Ok');
    // Outside the newest window, Tab goes round the page.
    button('Page').focus();
    expect(tab()).toBe(false);
  });
});

describe('the keyboard in a menu', () => {
  const entries = [
    { id: 'a', label: 'First', enabled: true },
    { id: 'b', label: 'Greyed', enabled: false },
    { id: 'c', label: 'Last', enabled: true },
  ];

  it('starts a right-click menu on its first entry; the arrows and Tab go round its entries', () => {
    render(
      <>
        <button>Page</button>
        <PopupMenu popup={{ menu: { title: 'Tile', entries }, x: 0, y: 0 }} run={() => {}} close={() => {}} />
      </>,
    );
    expect(focused()).toBe('First');
    press('ArrowDown');
    expect(focused()).toBe('Last');
    press('ArrowDown');
    expect(focused()).toBe('First');
    press('ArrowUp');
    expect(focused()).toBe('Last');
    press('Home');
    expect(focused()).toBe('First');
    press('End');
    expect(focused()).toBe('Last');
    expect(tab()).toBe(true);
    expect(focused()).toBe('First');
  });

  it('opens a menu bar menu on its first entry, and Left and Right step to the menus beside', () => {
    const items = (label: string) => [{ label, run: () => {} }];
    render(
      <MenuBar
        menus={[
          { name: 'Game', items: items('Save') },
          { name: 'View', items: items('Zoom in') },
          { name: 'Orders', items: [] },
          { name: 'Report', items: items('Turn report') },
        ]}
        status=""
      />,
    );
    act(() => screen.getByRole('menuitem', { name: 'Game' }).click());
    expect(focused()).toBe('Save');
    expect(tab()).toBe(true);
    expect(focused()).toBe('Save');
    press('ArrowRight');
    expect(focused()).toBe('Zoom in');
    // Orders has no entries, so it is passed over.
    press('ArrowRight');
    expect(focused()).toBe('Turn report');
    press('ArrowRight');
    expect(focused()).toBe('Save');
    press('ArrowLeft');
    expect(focused()).toBe('Turn report');
  });
});
