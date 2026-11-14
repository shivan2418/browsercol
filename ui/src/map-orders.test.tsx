// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { Command } from './input';
import { MapOrders } from './map-orders';

afterEach(cleanup);

describe('MapOrders', () => {
  it('draws nothing without an active unit', () => {
    render(<MapOrders orders={['sentry']} active={false} run={() => {}} />);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('enables the orders the Engine offers and runs the one clicked', () => {
    const ran: Command[] = [];
    render(<MapOrders orders={['sentry', 'buildColony']} active run={(c) => ran.push(c)} />);
    expect((screen.getByRole('button', { name: 'Fortify' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Build colony' }));
    expect(ran).toEqual([{ k: 'buildColony' }]);
  });

  it("draws a button as FreeCol's pictures where the art has them, and keeps its name for the hint and the screen reader", () => {
    const art = (keys: readonly string[]) => `art/${keys[0]}.png`;
    render(<MapOrders orders={['sentry']} active run={() => {}} art={art} />);
    const sentry = screen.getByRole('button', { name: 'Sentry' });
    expect(sentry.className).toBe('pictured');
    expect(sentry.style.getPropertyValue('--normal')).toContain('image.miscicon.button.normal.sentry');
    expect(sentry.textContent).toBe('');
    // Skip is FreeCol's "done" picture; Swing has no Go to button, so the row has none.
    expect(screen.getByRole('button', { name: 'Skip' }).style.getPropertyValue('--pressed')).toContain('pressed.done');
    expect(screen.queryByRole('button', { name: 'Go to' })).toBeNull();
  });

  it('adds Wait, Go to and Next unit on tile on a touch screen only', () => {
    const { rerender } = render(<MapOrders orders={['goto']} active run={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Wait' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go to' })).toBeNull();
    const ran: Command[] = [];
    let goTos = 0;
    rerender(<MapOrders orders={['goto']} active touch run={(c) => ran.push(c)} goTo={() => goTos++} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wait' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next unit on tile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to' }));
    expect(ran).toEqual([{ k: 'nextUnit' }, { k: 'change' }]);
    expect(goTos).toBe(1);
  });

  it('keeps Go to pressed and clickable while a destination is being chosen, and off when the unit cannot go', () => {
    const { rerender } = render(<MapOrders orders={[]} active touch run={() => {}} />);
    expect((screen.getByRole('button', { name: 'Go to' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<MapOrders orders={[]} active touch choosing run={() => {}} />);
    const goTo = screen.getByRole('button', { name: 'Go to' }) as HTMLButtonElement;
    expect(goTo.disabled).toBe(false);
    expect(goTo.getAttribute('aria-pressed')).toBe('true');
  });
});
