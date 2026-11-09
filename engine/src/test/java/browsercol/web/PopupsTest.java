package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;


/** What waits for the open pop-ups goes on once the last is closed (#433). */
class PopupsTest {

    @Test
    void nothingWaitsWhileNoneIsOpen() {
        final Popups p = new Popups();
        assertFalse(p.showing());
        final int a = p.opened();
        assertEquals(Popups.Then.NOTHING, p.closed(a), "nothing asked while it was open");
    }

    @Test
    void theGoToOrdersGoOnOnceTheLastIsClosed() {
        final Popups p = new Popups();
        final int a = p.opened();
        final int b = p.opened();
        assertTrue(p.showing(), "the Go To orders wait");
        assertEquals(Popups.Then.NOTHING, p.closed(a), "one is still open");
        assertEquals(Popups.Then.NOTHING, p.closed(a), "closed twice is closed once");
        assertEquals(Popups.Then.GO_ON, p.closed(b));
        assertFalse(p.showing());
        assertEquals(Popups.Then.NOTHING, p.closed(p.opened()), "the wait is over");
    }

    @Test
    void aTurnEndedMeanwhileEndsOnceTheyAreClosed() {
        final Popups p = new Popups();
        final int a = p.opened();
        p.endTurnAfter();
        assertEquals(Popups.Then.END_TURN, p.closed(a));
        assertEquals(Popups.Then.NOTHING, p.closed(p.opened()), "once only");
    }
}
