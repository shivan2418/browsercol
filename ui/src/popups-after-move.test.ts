import { describe, expect, it } from 'vite-plus/test';
import { popupsAfterMove, viewHold } from './after-slide';
import { webGui } from './webgui';

/** The Engine's events, as fcShow takes them, into a map that slides until the test draws it. */
function game() {
  let on = false;
  let end: () => void = () => {};
  let ended = Promise.resolve();
  const seen: string[] = [];
  const hold = viewHold(
    () => on,
    () => ended,
  );
  const gui = webGui(
    {
      events: popupsAfterMove(
        {
          animateMove: () => {
            on = true;
            ended = new Promise<void>((ok) => (end = ok));
            seen.push('slide');
          },
          information: () => seen.push('information'),
          eventPanel: () => seen.push('eventPanel'),
          messages: () => seen.push('messages'),
          error: () => seen.push('error'),
        },
        hold,
      ),
      questions: {} as never,
    },
    () => {},
  );
  return {
    seen,
    gui,
    idle: () => hold.idle(),
    drawn: () => {
      on = false;
      seen.push('drawn');
      end();
    },
  };
}

describe('popupsAfterMove', () => {
  it('shows the pop-up a move raises after the unit has been drawn on its new tile', async () => {
    const g = game();
    g.gui.fcShow('animateMove', '{}');
    g.gui.fcShow('information', '{}');
    g.gui.fcShow('eventPanel', '{}');
    g.gui.fcShow('messages', '{}');
    expect(g.seen).toEqual(['slide']);
    g.drawn();
    await g.idle();
    expect(g.seen).toEqual(['slide', 'drawn', 'information', 'eventPanel', 'messages']);
  });

  it('shows a pop-up at once when no move is being drawn', () => {
    const g = game();
    g.gui.fcShow('information', '{}');
    expect(g.seen).toEqual(['information']);
  });

  it('does not hold an error behind a move', () => {
    const g = game();
    g.gui.fcShow('animateMove', '{}');
    g.gui.fcShow('error', '{}');
    expect(g.seen).toEqual(['slide', 'error']);
  });
});
