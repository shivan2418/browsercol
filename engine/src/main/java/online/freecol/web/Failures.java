package online.freecol.web;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.function.BiConsumer;


/**
 * What a "failed" event says of an exception. {@code String.valueOf(ex)}
 * is only the class name for an exception with no message, such as an
 * EOFException (#31), so the event carries the stack trace and the causes
 * too, for the page's {@code window.fcResult} to show.
 */
final class Failures {

    private Failures() {}

    /**
     * Where {@link #report} sends a failure: (what failed, its
     * description). ClientMain and WorkerMain send it to the page as an
     * "error" event, which the Browser UI shows, so a game that breaks
     * does not break silently. Nothing, until they set it (the JVM tests).
     */
    private static volatile BiConsumer<String, String> sink = (what, detail) -> {};

    /** Send the failures {@link #report} is given to {@code to}. */
    static void reportTo(BiConsumer<String, String> to) {
        sink = to;
    }

    /**
     * Report a failure the game goes on after, such as a message from the
     * other end that could not be handled.
     *
     * @param what What failed, for the player.
     * @param ex What went wrong.
     */
    static void report(String what, Throwable ex) {
        try {
            sink.accept(what, describe(ex));
        } catch (Throwable ignored) {
            // A report that cannot be sent must not break the caller as well.
        }
    }

    /**
     * @param ex What went wrong.
     * @return The exception, its stack trace and its causes, as text.
     */
    static String describe(Throwable ex) {
        StringWriter sw = new StringWriter();
        try (PrintWriter pw = new PrintWriter(sw)) {
            ex.printStackTrace(pw);
        }
        String text = sw.toString().trim();
        // Some runtimes print nothing for a trace they cannot make.
        return text.isEmpty() ? String.valueOf(ex) : text;
    }
}
