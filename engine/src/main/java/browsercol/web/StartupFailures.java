package browsercol.web;

/**
 * What an exception in an invokeLater task means for the page. FreeCol's
 * Swing client logs an uncaught exception on the event thread and goes on,
 * and so do we once the game is running: a report for each would bury the
 * player in failures FreeCol itself shrugs off. Before the game has started
 * (before the gameStarted event) there is no game to go on with, and the
 * page waits for that event for ever, so the failure is reported as fatal.
 */
final class StartupFailures {

    private static volatile boolean started = false;

    private StartupFailures() {}

    /** The game has started: later task failures are only logged. */
    static void gameStarted() {
        started = true;
    }

    /** Forget that a game started (the JVM tests). */
    static void reset() {
        started = false;
    }

    /** A task given to invokeLater threw {@code ex}. */
    static void taskFailed(Throwable ex) {
        if (!started) Failures.reportFatal(ex);
    }
}
