// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { lane, OVER } from './drag';
import { dragOnto } from './drag.testing';

const things = lane<string>();
const other = lane<string>();

/** A thing to drag, a place that takes it inside a place that takes anything, and a place of another lane. */
function Board({ drops, clicks }: { drops: string[]; clicks: string[] }) {
  return (
    <div>
      <span
        id="thing"
        {...things.source((keys) => (keys.shiftKey ? 'some' : 'all'))}
        onClick={() => clicks.push('thing')}
      >
        <img alt="" src="x.png" />
        <b>50</b>
      </span>
      <div
        id="outer"
        {...things.target(
          () => true,
          (t) => drops.push(`outer ${t}`),
        )}
      >
        <div
          id="inner"
          {...things.target(
            (t) => t === 'all',
            (t) => drops.push(`inner ${t}`),
          )}
        />
      </div>
      <div
        id="elsewhere"
        {...other.target(
          () => true,
          (t) => drops.push(`elsewhere ${t}`),
        )}
      />
      <div id="nothing" />
    </div>
  );
}

const $ = (id: string) => document.getElementById(id)!;

describe('a drag with the pointer', () => {
  afterEach(cleanup);

  it('drops on the innermost place that takes the thing, and leaves the rest to the place around it', () => {
    const drops: string[] = [];
    render(<Board drops={drops} clicks={[]} />);
    act(() => dragOnto($('thing'), $('inner')));
    act(() => dragOnto($('thing'), $('inner'), { shiftKey: true }));
    act(() => dragOnto($('thing'), $('elsewhere')));
    act(() => dragOnto($('thing'), $('nothing')));
    expect(drops).toEqual(['inner all', 'outer some']);
  });

  it('is no drag until the pointer has moved, so a click is a click', () => {
    const drops: string[] = [];
    const clicks: string[] = [];
    render(<Board drops={drops} clicks={clicks} />);
    fireEvent.pointerDown($('thing'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove($('thing'), { clientX: 1, clientY: 1 });
    expect(document.querySelector('.drag-ghost')).toBeNull();
    fireEvent.pointerUp($('outer'), { clientX: 1, clientY: 1 });
    fireEvent.click($('thing'));
    expect(drops).toEqual([]);
    expect(clicks).toEqual(['thing']);
  });

  it('carries a copy of the thing, marks the place under it that takes it, and ends with neither', () => {
    const drops: string[] = [];
    render(<Board drops={drops} clicks={[]} />);
    fireEvent.pointerDown($('thing'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove($('inner'), { clientX: 30, clientY: 20 });
    const ghost = document.querySelector<HTMLElement>('.drag-ghost')!;
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.textContent).toBe('50');
    expect(ghost.querySelector('[id]')).toBeNull();
    expect(ghost.style.transform).toBe('translate(30px, 20px)');
    expect($('inner').classList.contains(OVER)).toBe(true);
    expect($('outer').classList.contains(OVER)).toBe(false);
    fireEvent.pointerMove($('nothing'), { clientX: 40, clientY: 20 });
    expect($('inner').classList.contains(OVER)).toBe(false);
    fireEvent.pointerMove($('elsewhere'), { clientX: 50, clientY: 20 });
    expect($('elsewhere').classList.contains(OVER)).toBe(false);
    fireEvent.pointerUp($('nothing'), { clientX: 50, clientY: 20 });
    expect(document.querySelector('.drag-ghost')).toBeNull();
    expect(document.querySelector(`.${OVER}`)).toBeNull();
    expect(drops).toEqual([]);
  });

  it('carries a copy that takes no pointer events anywhere in it, as what sits under it must get the release (#358)', () => {
    render(
      <div>
        <span id="goods" {...things.source(() => 'all')}>
          <b style={{ pointerEvents: 'auto' }}>
            <i style={{ pointerEvents: 'auto' }}>50</i>
          </b>
        </span>
      </div>,
    );
    fireEvent.pointerDown($('goods'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove($('goods'), { clientX: 30, clientY: 0 });
    const ghost = document.querySelector<HTMLElement>('.drag-ghost')!;
    // The page's own style makes the ghost's root take none; its descendants inherit that, unless the copy set theirs.
    for (const e of ghost.querySelectorAll<HTMLElement>('*')) expect(e.style.pointerEvents).not.toBe('auto');
    fireEvent.pointerUp($('goods'), { clientX: 30, clientY: 0 });
  });

  it('carries only the thing, not the box its hover or pick highlight drew behind it', () => {
    render(
      <div>
        <span
          id="goods"
          style={{ background: 'beige', outline: '2px solid red', boxShadow: '0 0 4px red' }}
          {...things.source(() => 'all')}
        >
          <img alt="" style={{ background: 'white' }} />
        </span>
      </div>,
    );
    fireEvent.pointerDown($('goods'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove($('goods'), { clientX: 30, clientY: 0 });
    const copy = document.querySelector<HTMLElement>('.drag-ghost > div > *')!;
    expect(copy.style.background).toBe('none');
    expect(copy.style.outline).toBe('none');
    expect(copy.style.boxShadow).toBe('none');
    // The thing's own parts keep their look.
    expect(copy.querySelector('img')!.style.background).toBe('rgb(255, 255, 255)');
    fireEvent.pointerUp($('goods'), { clientX: 30, clientY: 0 });
  });

  it('puts the thing back on Escape, which goes no further', () => {
    const drops: string[] = [];
    const keys: string[] = [];
    const onKey = (e: KeyboardEvent) => keys.push(e.key);
    addEventListener('keydown', onKey);
    render(<Board drops={drops} clicks={[]} />);
    fireEvent.pointerDown($('thing'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove($('inner'), { clientX: 30, clientY: 0 });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(document.querySelector('.drag-ghost')).toBeNull();
    expect($('inner').classList.contains(OVER)).toBe(false);
    fireEvent.pointerUp($('inner'), { clientX: 30, clientY: 0 });
    expect(drops).toEqual([]);
    // With no drag under way, Escape is the page's again.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    removeEventListener('keydown', onKey);
    expect(keys).toEqual(['Escape']);
  });

  it('takes the click that ends a drag, which is no click on what was dragged', () => {
    const clicks: string[] = [];
    render(<Board drops={[]} clicks={clicks} />);
    fireEvent.pointerDown($('thing'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove($('thing'), { clientX: 30, clientY: 0 });
    fireEvent.pointerUp($('thing'), { clientX: 30, clientY: 0 });
    fireEvent.click($('thing'));
    // Nor is the click of a drag that Escape put back.
    fireEvent.pointerDown($('thing'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove($('thing'), { clientX: 30, clientY: 0 });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.pointerUp($('thing'), { clientX: 30, clientY: 0 });
    fireEvent.click($('thing'));
    expect(clicks).toEqual([]);
    // The next click is the player's.
    fireEvent.click($('thing'));
    expect(clicks).toEqual(['thing']);
  });
});
