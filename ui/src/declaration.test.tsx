// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import signatureFile from '../../freecol/data/base/resources/fonts/signature.faf?raw';
import { dialogs } from './dialogs';
import { DECLARATION_SIZE, declarationTiming, signatureFont } from './declaration';
import { DialogHost, type Art } from './panels';
import { abbreviate, parseFAF, signatureName } from './signature';

afterEach(cleanup);

const font = parseFAF(signatureFile);

describe('the signature font', () => {
  it('reads FreeCol signature.faf: letters, with their points and their size', () => {
    expect(font.has('W')).toBe(true);
    expect(font.has('☃')).toBe(false);
    const points = font.points('William I');
    expect(points.length).toBeGreaterThan(500);
    const { width, height } = font.dimension('William I');
    expect(width).toBeGreaterThan(50);
    expect(width).toBeLessThan(DECLARATION_SIZE.width);
    expect(height).toBeGreaterThan(0);
    // The points lie in the box the dimension gives, as the canvas is that size.
    expect(Math.max(...points.map((p) => p.y))).toBeLessThanOrEqual(height);
  });

  it('draws a letter after the one before it: each advances the pen', () => {
    const one = font.points('W');
    const two = font.points('WW');
    expect(two.length).toBe(one.length * 2);
    expect(Math.max(...two.map((p) => p.x))).toBeGreaterThan(Math.max(...one.map((p) => p.x)));
  });

  it('drops the letters it cannot write', () => {
    expect(font.onlyValid('Wi☃lliam')).toBe('William');
    expect(signatureName(font, '☃☃', 515)).toBe('');
  });

  it('writes a name that fits as it is, and shortens one that does not, as DeclarationPanel does', () => {
    const limit = 515;
    expect(abbreviate(font, 'William I', limit)).toBe('William I');
    const long = 'Maximilian Alexander Bartholomew Wolfgang Hohenzollern Habsburg Romanov';
    expect(font.dimension(long).width).toBeGreaterThan(limit);
    const short = abbreviate(font, long, limit);
    expect(font.dimension(short).width).toBeLessThanOrEqual(limit);
    // The middle names go to initials first, and the first and the last names stay.
    expect(short.startsWith('Maximilian')).toBe(true);
    expect(short.endsWith('Romanov')).toBe(true);
    // A tight limit takes the first name down to its initial, then the last name too.
    expect(abbreviate(font, 'William Bradford', font.dimension('W. Bradford').width)).toBe('W. Bradford');
    expect(abbreviate(font, 'William Bradford', font.dimension('W. B.').width)).toBe('W. B.');
  });
});

const art: Art = (keys) => (keys.includes('image.flavor.Declaration') ? 'art/doi.png' : null);

function open(name = 'William I') {
  const box = dialogs();
  render(<DialogHost dialogs={box} goTo={() => {}} art={art} report={null!} routes={null!} />);
  let answer!: Promise<true>;
  act(() => void (answer = box.ask('declaration', { name, title: 'Declare Independence' })));
  return { box, answer };
}

describe('the declaration panel', () => {
  const loads = vi.fn(() => Promise.resolve(font));
  const wasTiming = { ...declarationTiming };
  const wasLoad = signatureFont.load;
  beforeEach(() => {
    vi.useFakeTimers();
    loads.mockClear();
    signatureFont.load = loads;
    Object.assign(declarationTiming, { start: 2000, tick: 15, step: 3, finish: 5000 });
  });
  afterEach(() => {
    vi.useRealTimers();
    signatureFont.load = wasLoad;
    Object.assign(declarationTiming, wasTiming);
  });

  const panel = () => screen.getByRole('dialog', { name: 'Declare Independence' });
  const canvas = () => panel().querySelector('canvas');
  const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
  const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it('is the picture of the Declaration, with no text of the resolution', async () => {
    open();
    await settle();
    expect(panel().querySelector('img')?.getAttribute('src')).toBe('art/doi.png');
    expect(panel().textContent).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
    expect(panel().style.width).toBe(`${DECLARATION_SIZE.width}px`);
  });

  it('fetches the font when it opens, and not before', async () => {
    expect(loads).not.toHaveBeenCalled();
    const { answer } = open();
    expect(loads).toHaveBeenCalledTimes(1);
    fireEvent.click(panel());
    await answer;
  });

  it('waits two seconds, signs the name stroke by stroke, then closes five seconds after', async () => {
    const { answer } = open();
    let closed = false;
    void answer.then(() => (closed = true));
    await settle();
    expect(panel().getAttribute('data-phase')).toBe('waiting');
    expect(canvas()?.getAttribute('data-signature')).toBe('William I');
    expect(canvas()?.dataset.drawn).toBeUndefined();

    await wait(2000 + 15 * 10);
    expect(panel().getAttribute('data-phase')).toBe('signing');
    // Three points to a step, as DeclarationPanel draws them.
    expect(canvas()?.dataset.drawn).toBe('30');

    const total = font.points('William I').length;
    await wait(15 * (Math.ceil(total / 3) - 10));
    expect(panel().getAttribute('data-phase')).toBe('signed');
    expect(canvas()?.dataset.drawn).toBe(String(total));
    expect(closed).toBe(false);

    await wait(4999);
    expect(closed).toBe(false);
    await wait(1);
    await expect(answer).resolves.toBe(true);
    expect(closed).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a click, once, even mid-signature', async () => {
    const { answer, box } = open();
    await settle();
    await wait(2500);
    expect(panel().getAttribute('data-phase')).toBe('signing');
    fireEvent.click(panel());
    fireEvent.click(document.body);
    await expect(answer).resolves.toBe(true);
    expect(box.current()).toBeNull();
  });

  it('closes on a key, but not on one held down from before', async () => {
    const { answer } = open();
    await settle();
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'x' });
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('signs a long name abbreviated, to fit the picture', async () => {
    open('Maximilian Alexander Bartholomew Wolfgang Hohenzollern Habsburg Romanov');
    await settle();
    const signed = canvas()!.getAttribute('data-signature')!;
    expect(signed.length).toBeLessThan(40);
    expect(font.dimension(signed).width).toBeLessThanOrEqual(DECLARATION_SIZE.width - 10);
  });

  it('has nothing to sign for a name of no letters of the font, and closes by itself', async () => {
    const { answer } = open('☃');
    await settle();
    expect(canvas()).toBeNull();
    await wait(2100);
    await wait(5100);
    await expect(answer).resolves.toBe(true);
  });

  it('closes by itself when the font cannot be fetched', async () => {
    signatureFont.load = () => Promise.reject(new Error('offline'));
    const { answer } = open();
    await settle();
    expect(panel().getAttribute('data-phase')).toBe('signed');
    await wait(5000 + 100);
    await expect(answer).resolves.toBe(true);
  });
});
