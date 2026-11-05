package browsercol.probe;

/**
 * Which reachable code breaks Object.wait under TeaVM Wasm GC? Build with
 * -Pmain=browsercol.probe.WaitProbe and run probe.mjs. The wait works
 * with reach() empty and breaks once reach() calls into FreeCol, even
 * though reach() never runs (spike/README.md, "Isolating the cause").
 */
public class WaitProbe {
    public static void main(String[] args) throws Exception {
        String mode = args.length > 0 ? args[0] : "";
        if (mode.equals("never")) { // keeps code reachable without running it
            reach(args);
        }
        Object lock = new Object();
        long t = System.currentTimeMillis();
        synchronized (lock) { lock.wait(110); }
        System.err.println("probe: main timed wait returned after "
            + (System.currentTimeMillis() - t) + "ms");
    }

    static void reach(String[] args) throws Exception {
        // Put a call here to make code reachable without running it, e.g.
        // browsercol.spike.SpikeMain.main(args);
        browsercol.spike.SpikeMain.main(args);
    }
}
