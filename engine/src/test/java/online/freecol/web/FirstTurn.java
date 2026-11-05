package online.freecol.web;

import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.opentest4j.AssertionFailedError;


/**
 * Waiting for the human's first turn, which every test that starts a game
 * does. When it does not come, the failure carries what every thread was
 * doing, so that a game that never starts says where it stopped.
 */
final class FirstTurn {

    private FirstTurn() {}

    /** What the Engine reported as failed (Failures.report) since the last wait. */
    private static final java.util.List<String> failures
        = java.util.Collections.synchronizedList(new java.util.ArrayList<>());

    static {
        Failures.reportTo((what, detail) -> failures.add(what + "\n" + detail));
    }

    /** The longest a game takes to reach the human's first turn. */
    static final int SECONDS = 120;

    /**
     * Wait for the first turn.
     *
     * @param ourTurn Counted down when it is the human's turn.
     * @throws InterruptedException if the test is interrupted.
     * @throws AssertionFailedError with the threads' stacks if it never comes.
     */
    static void await(CountDownLatch ourTurn) throws InterruptedException {
        if (ourTurn.await(SECONDS, TimeUnit.SECONDS)) {
            failures.clear();
            return;
        }
        throw new AssertionFailedError("our first turn did not come in " + SECONDS + " s.\nReported failures: "
            + failures + "\nThe threads:\n" + threads());
    }

    /** Every live thread and its stack. */
    static String threads() {
        final StringBuilder sb = new StringBuilder();
        for (Map.Entry<Thread, StackTraceElement[]> e : Thread.getAllStackTraces().entrySet()) {
            sb.append('"').append(e.getKey().getName()).append("\" ").append(e.getKey().getState()).append('\n');
            for (StackTraceElement f : e.getValue()) sb.append("    at ").append(f).append('\n');
        }
        return sb.toString();
    }
}
