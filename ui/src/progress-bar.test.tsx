// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { RebelTipBox } from './colony-panel';
import { GoodsProgressBar, type Art } from './frame';
import { barSegments } from './progress-bar';
import { PROGRESS_CASES } from './progress-bar-cases';

afterEach(cleanup);

const art: Art = () => null;
const pct = (s: string) => parseFloat(s);
const rebel = (value: number, step: number, max: number, text: string) => ({
  members: [] as [string, string, string][],
  liberty: [],
  bar: { keys: [], value, step, max, text },
  turns: [] as [string, string][],
});

describe('barSegments', () => {
  it.each(PROGRESS_CASES)('keeps the value and the step inside the bar: $name', ({ value, step, max }) => {
    const { now, next } = barSegments(value, step, max);
    expect(Number.isNaN(now) || Number.isNaN(next)).toBe(false);
    expect(now).toBeGreaterThanOrEqual(0);
    expect(next).toBeGreaterThanOrEqual(0);
    expect(now).toBeLessThanOrEqual(100);
    expect(now + next).toBeLessThanOrEqual(100);
  });

  it('draws what is there, then what comes next, cut off at the maximum', () => {
    expect(barSegments(50, 10, 200)).toEqual({ now: 25, next: 5 });
    expect(barSegments(188, 21, 200)).toEqual({ now: 94, next: 6 });
    expect(barSegments(200, 5, 200)).toEqual({ now: 100, next: 0 });
    expect(barSegments(250, 5, 200)).toEqual({ now: 100, next: 0 });
    expect(barSegments(0, 0, 200)).toEqual({ now: 0, next: 0 });
    expect(barSegments(20, -5, 200)).toEqual({ now: 10, next: 0 });
    expect(barSegments(-20, 5, 200)).toEqual({ now: 0, next: 2.5 });
  });

  it('is empty or full, never NaN, for a maximum of 0 or less', () => {
    expect(barSegments(0, 3, 0)).toEqual({ now: 100, next: 0 });
    expect(barSegments(-4, 3, 0)).toEqual({ now: 0, next: 0 });
    expect(barSegments(5, 1, -2)).toEqual({ now: 100, next: 0 });
  });
});

describe('the goods progress bar (building, immigration, liberty, founding fathers)', () => {
  it.each(PROGRESS_CASES)('stays inside its bar: $name', ({ value, step, max }) => {
    const need = {
      type: 'model.goods.hammers',
      name: 'Hammers',
      keys: [],
      amount: max,
      needed: max,
      available: value,
      produced: step,
      turns: '(Turns: 1)',
    };
    const { container } = render(<GoodsProgressBar need={need} art={art} />);
    const now = container.querySelector<HTMLElement>('.need i.now')!;
    const next = container.querySelector<HTMLElement>('.need i.next');
    const nowW = pct(now.style.width);
    const nextW = next ? pct(next.style.width) : 0;
    expect(nowW).toBeLessThanOrEqual(100);
    expect(nowW + nextW).toBeLessThanOrEqual(100);
    expect(pct(next?.style.left ?? '0')).toBeLessThanOrEqual(100);
    // The text keeps the real numbers.
    expect(container.querySelector('.need')!.textContent).toBe(
      `${value}${step < 0 ? '-' : '+'}${Math.abs(step)}/${max} (Turns: 1)`,
    );
  });
});

describe('the rebel tooltip bar', () => {
  it('stops at the right edge for 188+21/200, and says the numbers as they are', () => {
    const { container } = render(<RebelTipBox tip={rebel(188, 21, 200, '188+21/200 (Turns: 1)')} art={art} />);
    const value = container.querySelector<HTMLElement>('.tip-bar i.value')!;
    const step = container.querySelector<HTMLElement>('.tip-bar i.step')!;
    expect(value.style.width).toBe('94%');
    expect(step.style.left).toBe('94%');
    expect(step.style.width).toBe('6%');
    expect(container.querySelector('.tip-bar .label')!.textContent).toBe('188+21/200 (Turns: 1)');
  });

  it.each(PROGRESS_CASES)('stays inside its bar: $name', ({ value, step, max }) => {
    const { container } = render(<RebelTipBox tip={rebel(value, step, max, `${value}+${step}/${max}`)} art={art} />);
    const v = pct(container.querySelector<HTMLElement>('.tip-bar i.value')!.style.width);
    const s = container.querySelector<HTMLElement>('.tip-bar i.step')!;
    expect(v).toBeLessThanOrEqual(100);
    expect(pct(s.style.left) + pct(s.style.width)).toBeLessThanOrEqual(100);
    expect(container.querySelector('.tip-bar')!.innerHTML).not.toContain('NaN');
  });
});
