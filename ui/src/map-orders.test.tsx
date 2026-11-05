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
});
