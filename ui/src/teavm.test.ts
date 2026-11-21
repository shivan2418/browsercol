import { describe, expect, it } from 'vite-plus/test';
import { immediateScheduler } from './teavm';

type Async = { offer(i: unknown, fn: (i: unknown) => void, time: number): number; kill(id: number): void };
const scheduler = () => {
  const imports: Record<string, Record<string, unknown>> = {};
  immediateScheduler(imports);
  return imports.teavmAsync as unknown as Async;
};
const later = (ms = 20) => new Promise((ok) => setTimeout(ok, ms));

describe('the Engine threads scheduler', () => {
  it('runs what is offered for now at the next turn, in order, with the instance', async () => {
    const a = scheduler();
    const ran: unknown[] = [];
    a.offer('x', (i) => ran.push(['first', i]), Date.now());
    a.offer('y', (i) => ran.push(['second', i]), 0);
    expect(ran).toEqual([]);
    await later();
    expect(ran).toEqual([
      ['first', 'x'],
      ['second', 'y'],
    ]);
  });

  it('runs what is offered for later after its time, as a timer', async () => {
    const a = scheduler();
    const at = Date.now();
    let ranAt = 0;
    a.offer(null, () => (ranAt = Date.now()), at + 40);
    await later(10);
    expect(ranAt).toBe(0);
    await later(80);
    expect(ranAt).toBeGreaterThanOrEqual(at + 35);
  });

  it('does not run what was killed, whichever way it was offered', async () => {
    const a = scheduler();
    let ran = 0;
    a.kill(a.offer(null, () => ran++, 0));
    a.kill(a.offer(null, () => ran++, Date.now() + 20));
    await later(60);
    expect(ran).toBe(0);
  });

  it('gives each job its own id', () => {
    const a = scheduler();
    const ids = new Set([0, 0, 0].map(() => a.offer(null, () => {}, 0)));
    expect(ids.size).toBe(3);
  });
});
