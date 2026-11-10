package browsercol.web;

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
        = new java.util.concurrent.CopyOnWriteArrayList<>();

    static {
        Failures.reportTo((what, detail) -> failures.add(what + "\n" + detail));
        watchTheEventThread();
    }

    /**
     * AWT prints what a task on the event thread throws and goes on, so it
     * never reached Failures.report (#227). An event queue that reports it
     * does.
     */
    private static void watchTheEventThread() {
        java.awt.Toolkit.getDefaultToolkit().getSystemEventQueue().push(new java.awt.EventQueue() {
            @Override
            protected void dispatchEvent(java.awt.AWTEvent event) {
                try {
                    super.dispatchEvent(event);
                } catch (Throwable ex) {
                    Failures.report("the AWT event thread", ex);
                    throw ex;
                }
            }
        });
    }

    /** What the Engine reported as failed since the last wait. */
    static java.util.List<String> reported() {
        synchronized (failures) {
            return new java.util.ArrayList<>(failures);
        }
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
        final String report = "our first turn did not come in " + SECONDS + " s.\nReported failures: "
            + failures + "\n" + machine() + "\nThe threads:\n" + threads();
        throw new AssertionFailedError(report + keep(report));
    }

    /**
     * Keep a report where the next test run does not overwrite it, as it
     * does the test results (#440): build/first-turn/ in the Engine.
     *
     * @return A line saying where it is, or why it could not be kept.
     */
    private static String keep(String report) {
        final String src = System.getProperty("engine.src");
        if (src == null) return "";
        final java.io.File file = new java.io.File(new java.io.File(src, "../build/first-turn"),
            "first-turn-" + ProcessHandle.current().pid() + "-" + System.currentTimeMillis() + ".txt");
        try {
            file.getParentFile().mkdirs();
            java.nio.file.Files.writeString(file.toPath(), report);
            return "\nKept in " + file.toPath().normalize();
        } catch (java.io.IOException ex) {
            return "\nCould not keep this report: " + ex;
        }
    }

    /**
     * How loaded the JVM and the machine were: a game slowed by a heap
     * near its limit or a busy machine (#439, #440) says so here, and a
     * game that hung while both were fine points at a lost message.
     */
    static String machine() {
        final Runtime rt = Runtime.getRuntime();
        final long mb = 1024 * 1024;
        long gcMillis = 0;
        for (java.lang.management.GarbageCollectorMXBean gc
                 : java.lang.management.ManagementFactory.getGarbageCollectorMXBeans()) {
            gcMillis += Math.max(0, gc.getCollectionTime());
        }
        return "Heap: " + (rt.totalMemory() - rt.freeMemory()) / mb + " MB used of " + rt.maxMemory() / mb
            + " MB, " + gcMillis / 1000 + " s in GC since the JVM started; load average "
            + java.lang.management.ManagementFactory.getOperatingSystemMXBean().getSystemLoadAverage()
            + " on " + rt.availableProcessors() + " CPUs.";
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
