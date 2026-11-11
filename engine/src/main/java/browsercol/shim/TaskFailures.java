package browsercol.shim;

import java.util.function.Consumer;

/**
 * Who is told of an invokeLater task that throws. It is a class of its own
 * because TeaVM compiles the shim TSwingUtilities as javax.swing.SwingUtilities,
 * a different class from the one the Engine's own code names, so a listener set
 * on the shim from the Engine would never be seen by the compiled one.
 */
public final class TaskFailures {

    private static volatile Consumer<Throwable> listener = ex -> {};

    private TaskFailures() {}

    /** Have {@code to} told of every invokeLater task that throws. */
    public static void listen(Consumer<Throwable> to) {
        listener = to;
    }

    /** A task threw {@code ex}; a listener that breaks is ignored. */
    public static void failed(Throwable ex) {
        try {
            listener.accept(ex);
        } catch (Throwable ignored) {
            // It must not stop the later tasks either.
        }
    }
}
