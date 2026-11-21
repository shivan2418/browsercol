package browsercol.web;


/**
 * Where the Engine reports what its work costs, for the browser's
 * performance timeline (scripts/move-latency.ts reads it): the client
 * module installs one, and there is none by default, as in the JVM tests
 * and the server module.
 */
final class Timing {

    /** A place to report to. */
    interface Probe {
        /** @return The time now in milliseconds. */
        double now();

        /** Report that the named work ran from start to now. */
        void measure(String name, double start);

        /** Report that the named point has been reached. */
        void mark(String name);
    }

    private static volatile Probe probe = null;

    private Timing() {}

    static void install(Probe p) {
        probe = p;
    }

    /**
     * Whether anything listens. A caller that builds a name to report checks
     * this first, so that with nothing listening it allocates nothing.
     */
    static boolean on() {
        return probe != null;
    }

    static double now() {
        final Probe p = probe;
        return (p == null) ? 0 : p.now();
    }

    static void measure(String name, double start) {
        final Probe p = probe;
        if (p != null) p.measure(name, start);
    }

    static void mark(String name) {
        final Probe p = probe;
        if (p != null) p.mark(name);
    }
}
