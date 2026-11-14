// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { cancelPress, fromTap, lane, picked, TAP_SLOP } from './drag';
import { TAB_HOVER_MS, useTabHover } from './drag-tab';

const things = lane<string>();

/** A thing to move, one that a tap does not pick up, a place that takes it, one inside it that does not, and a button inside the thing. */
function Board({ drops }: { drops: string[] }) {
  return (
    <div>
      <span id="a" {...things.source(() => 'a')}>
        <button id="inside">go</button>
      </span>
      <span id="b" {...things.source(() => 'b')} />
      <span id="stays" {...things.source(() => 'stays', undefined, false)} />
      <div
        id="place"
        {...things.target(
          (t) => t !== 'b',
          (t) => drops.push(t),
        )}
      >
        <span id="inner" />
      </div>
      <div id="nothing" />
    </div>
  );
}

const $ = (id: string) => document.getElementById(id)!;

/** What a finger sends: the pointer's events of a touch, which a mouse's have no `pointerType` of. */
function touch(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x = 0, id = 1) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 0 });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  Object.defineProperty(e, 'pointerId', { value: id });
  act(() => void el.dispatchEvent(e));
}
const tap = (el: Element) => {
  touch(el, 'pointerdown');
  touch(el, 'pointerup');
};

describe('tap and tap', () => {
  afterEach(() => {
    cleanup();
    fireEvent.keyDown(document.body, { key: 'Escape' });
  });

  it('picks a thing up by a tap, and drops it on a place by another, as a drag onto it would', () => {
    const drops: string[] = [];
    render(<Board drops={drops} />);
    tap($('a'));
    expect(picked()).toBe(true);
    expect($('a').hasAttribute('data-picked')).toBe(true);
    tap($('inner'));
    expect(drops).toEqual(['a']);
    expect(picked()).toBe(false);
    expect($('a').hasAttribute('data-picked')).toBe(false);
  });

  it('puts the thing down on a tap on it again, on a spot that takes nothing, and on Escape', () => {
    const drops: string[] = [];
    render(<Board drops={drops} />);
    tap($('a'));
    tap($('a'));
    expect(picked()).toBe(false);
    tap($('a'));
    tap($('nothing'));
    expect(picked()).toBe(false);
    tap($('a'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(picked()).toBe(false);
    expect(drops).toEqual([]);
  });

  it('keeps Escape for the page when nothing is picked, and takes it when something is', () => {
    const keys: string[] = [];
    const onKey = (e: KeyboardEvent) => keys.push(e.key);
    addEventListener('keydown', onKey);
    render(<Board drops={[]} />);
    tap($('a'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    removeEventListener('keydown', onKey);
    expect(keys).toEqual(['Escape']);
  });

  it('picks the other thing when another is tapped, unless a place under it takes the first', () => {
    const drops: string[] = [];
    render(<Board drops={drops} />);
    tap($('b'));
    tap($('a'));
    expect($('a').hasAttribute('data-picked')).toBe(true);
    expect($('b').hasAttribute('data-picked')).toBe(false);
    expect(drops).toEqual([]);
  });

  it('does not drop what a place refuses, and puts it down there', () => {
    const drops: string[] = [];
    render(<Board drops={drops} />);
    tap($('b'));
    tap($('place'));
    expect(drops).toEqual([]);
    expect(picked()).toBe(false);
  });

  it('is no tap if the finger moved, was held to a long-press, or was a mouse', () => {
    const drops: string[] = [];
    render(<Board drops={drops} />);
    touch($('a'), 'pointerdown');
    touch($('a'), 'pointermove', TAP_SLOP + 1);
    touch($('a'), 'pointerup', TAP_SLOP + 1);
    expect(picked()).toBe(false);
    touch($('a'), 'pointerdown');
    cancelPress();
    touch($('a'), 'pointerup');
    expect(picked()).toBe(false);
    fireEvent.pointerDown($('a'), { clientX: 0, clientY: 0 });
    fireEvent.pointerUp($('a'), { clientX: 0, clientY: 0 });
    expect(picked()).toBe(false);
  });

  it('leaves a button inside the thing, and a source that opts out, to their own tap', () => {
    render(<Board drops={[]} />);
    tap($('inside'));
    expect(picked()).toBe(false);
    tap($('stays'));
    expect(picked()).toBe(false);
  });

  it('is no pick for a drag: a drag that starts puts the pick down', () => {
    const drops: string[] = [];
    render(<Board drops={drops} />);
    tap($('b'));
    touch($('a'), 'pointerdown');
    touch($('place'), 'pointermove', 30);
    expect(picked()).toBe(false);
    touch($('place'), 'pointerup', 30);
    expect(drops).toEqual(['a']);
  });

  it('takes the click that follows a drop, and says a click follows a tap', () => {
    const clicks: string[] = [];
    render(
      <div onClickCapture={undefined}>
        <Board drops={[]} />
      </div>,
    );
    $('inner').addEventListener('click', () => clicks.push('inner'));
    tap($('a'));
    tap($('inner'));
    expect(fromTap()).toBe(true);
    fireEvent.click($('inner'));
    expect(clicks).toEqual([]);
  });
});

describe('a tab a thing rests on', () => {
  afterEach(cleanup);

  function Tab({ open }: { open: () => void }) {
    const hover = useTabHover(open);
    return <button id="tab" {...hover} />;
  }

  it('opens after the thing has rested on it for a while, and not for a pointer that carries nothing', () => {
    vi.useFakeTimers();
    const open = vi.fn();
    render(
      <div>
        <Tab open={open} />
        <Board drops={[]} />
      </div>,
    );
    fireEvent.pointerEnter($('tab'));
    vi.advanceTimersByTime(TAB_HOVER_MS * 2);
    expect(open).not.toHaveBeenCalled();
    touch($('a'), 'pointerdown');
    touch($('nothing'), 'pointermove', 30);
    fireEvent.pointerEnter($('tab'));
    vi.advanceTimersByTime(TAB_HOVER_MS - 1);
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.pointerEnter($('tab'));
    fireEvent.pointerLeave($('tab'));
    vi.advanceTimersByTime(TAB_HOVER_MS * 2);
    expect(open).toHaveBeenCalledTimes(1);
    touch($('nothing'), 'pointerup', 30);
    vi.useRealTimers();
  });
});
