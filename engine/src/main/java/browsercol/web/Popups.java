package browsercol.web;

import java.util.HashSet;
import java.util.Set;


/**
 * The pop-ups on the Browser UI's screen: the information, error and event
 * panels and the messages, which the player reads and closes (#433).
 *
 * In Swing each is a panel on the canvas, and GUI.isPanelShowing says so
 * while it is: the client carries out no Go To orders and ends no turn
 * while one is open ("Wait for user to close outstanding panels",
 * InGameController.doExecuteGotoOrders and doEndTurn). A pop-up is no
 * question, so the {@link ModalGate} lets it pass, and the Engine goes on
 * at once. Here the Browser UI says when each one closes, and whatever
 * waited for them goes on then: so a move's pop-up (a rumour's outcome,
 * say) is read before another unit's Go To ends in a colony and opens its
 * panel over it.
 */
final class Popups {

    /** The ids of the pop-ups shown and not closed yet. */
    private final Set<Integer> open = new HashSet<>();
    /** The last id given. */
    private int last = 0;
    /** Something asked while one was open, and so waits for them to close. */
    private boolean waited = false;
    /** The player ended the turn while one was open. */
    private boolean endTurn = false;

    /** A pop-up is shown: its id, which the Browser UI gives back when it closes. */
    synchronized int opened() {
        final int id = ++this.last;
        this.open.add(id);
        return id;
    }

    /**
     * Whether a pop-up is open. If one is, the caller waits for it: the
     * Engine goes on once they are all closed.
     */
    synchronized boolean showing() {
        if (this.open.isEmpty()) return false;
        this.waited = true;
        return true;
    }

    /** The player ended the turn while a pop-up was open: it ends once they are closed. */
    synchronized void endTurnAfter() {
        this.endTurn = true;
        this.waited = true;
    }

    /** What to do once the last pop-up is closed. */
    enum Then { NOTHING, GO_ON, END_TURN }

    /**
     * A pop-up is closed.
     *
     * @param id Its id; an unknown one is ignored.
     * @return What waited for it, if it was the last one open.
     */
    synchronized Then closed(int id) {
        if (!this.open.remove(id) || !this.open.isEmpty() || !this.waited) return Then.NOTHING;
        final Then then = this.endTurn ? Then.END_TURN : Then.GO_ON;
        this.waited = false;
        this.endTurn = false;
        return then;
    }
}
