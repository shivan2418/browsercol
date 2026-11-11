import { describe, expect, it } from 'vite-plus/test';
import { reach, reachText, type Reachable } from './route-reach';

const europe: Reachable = { label: 'Europe', port: true, land: null };
const port = (label: string, land = 1): Reachable => ({ label, port: true, land });
const inland = (label: string, land = 1): Reachable => ({ label, port: false, land });

describe('which carriers can follow a trade route', () => {
  it('lets ships and wagon trains follow ports on one landmass', () => {
    expect(reach([port('Jamestown'), port('Plymouth')])).toMatchObject({ ships: true, wagons: true });
    expect(reachText([port('Jamestown'), port('Plymouth')])).toEqual({
      ok: true,
      text: 'Ships and wagon trains can follow this route.',
    });
  });

  it('keeps wagon trains out of Europe', () => {
    expect(reachText([europe, port('Jamestown')])).toEqual({
      ok: true,
      text: 'Only ships can follow this route: wagon trains cannot go to Europe.',
    });
  });

  it('keeps ships off inland colonies', () => {
    expect(reachText([port('Jamestown'), inland('Fort Orange')])).toEqual({
      ok: true,
      text: 'Only wagon trains can follow this route: ships cannot reach Fort Orange, inland.',
    });
  });

  it('keeps wagon trains on one landmass, Europe or not', () => {
    const r = reach([port('Jamestown', 1), port('Havana', 2), port('Santo Domingo', 3)]);
    expect(r).toMatchObject({ ships: true, wagons: false, across: ['Havana', 'Santo Domingo'] });
    expect(reachText([port('Jamestown', 1), port('Havana', 2), port('Santo Domingo', 3)])!.text).toBe(
      'Only ships can follow this route: wagon trains cannot leave Jamestown’s landmass for Havana and Santo Domingo.',
    );
  });

  it('says why no carrier can follow an inland colony and Europe, or inland colonies on two landmasses', () => {
    expect(reachText([inland('Fort Orange'), inland('Albany'), europe])).toEqual({
      ok: false,
      text: 'No carrier can follow this route: ships cannot reach Fort Orange and Albany, inland, and wagon trains cannot go to Europe.',
    });
    expect(reachText([inland('Fort Orange', 1), inland('Cuzco', 2)])!).toEqual({
      ok: false,
      text: 'No carrier can follow this route: ships cannot reach Fort Orange and Cuzco, inland, and wagon trains cannot leave Fort Orange’s landmass for Cuzco.',
    });
  });

  it('says nothing of a route of fewer than two stops', () => {
    expect(reachText([inland('Fort Orange')])).toBeNull();
  });
});
