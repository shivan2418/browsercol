package online.freecol.web;

import org.teavm.jso.JSBody;
import org.teavm.jso.JSExport;
import org.teavm.jso.typedarrays.Int8Array;


/**
 * Entry point of the server module, which runs in the Worker. The Worker
 * script (spike/web/worker.js) calls the exports and provides fcPost and
 * fcServerEvent.
 */
public final class WorkerMain {

    private static ServerEngine engine;

    @JSBody(params = "xml", script = "fcPost(xml);")
    private static native void post(String xml);

    @JSBody(params = { "name", "detail" }, script = "fcServerEvent(name, detail);")
    private static native void event(String name, String detail);

    /** Load the data files: (path, text) pairs. */
    public static void main(String[] args) {
        try {
            DataFiles.write(args);
        } catch (Exception ex) {
            event("failed", String.valueOf(ex));
            return;
        }
        engine = new ServerEngine(WorkerMain::post);
    }

    /** Start a new game, then report "started" with the time it took. */
    @JSExport
    public static void startGame(String rules) {
        new Thread(() -> {
                long t = System.currentTimeMillis();
                try {
                    engine.startGame(rules);
                    event("started", String.valueOf(System.currentTimeMillis() - t));
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("failed", String.valueOf(ex));
                }
        }, "web-startGame").start();
    }

    @JSBody(params = "bytes", script = "fcSaved(bytes);")
    private static native void saved(Int8Array bytes);

    /**
     * Save the game, then hand the savegame's bytes to fcSaved and
     * report "saved" with what the save list shows (ServerEngine.saveInfo)
     * and the time it took.
     *
     * @param activeUnitId The client's active unit, or empty for none.
     */
    @JSExport
    public static void saveGame(String activeUnitId) {
        new Thread(() -> {
                long t = System.currentTimeMillis();
                try {
                    String info = engine.saveInfo();
                    byte[] bytes = engine.saveGame(activeUnitId);
                    saved(Int8Array.copyFromJavaArray(bytes));
                    event("saved", info.substring(0, info.length() - 1)
                        + ",\"ms\":" + (System.currentTimeMillis() - t) + "}");
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("failed", String.valueOf(ex));
                }
        }, "web-saveGame").start();
    }

    /**
     * Load a game from a savegame's bytes in place of the current one,
     * then report "loaded" with the time it took and what was loaded.
     */
    @JSExport
    public static void loadGame(Int8Array savegame) {
        final byte[] bytes = savegame.copyToJavaArray();
        new Thread(() -> {
                long t = System.currentTimeMillis();
                try {
                    engine.loadGame(bytes);
                    long ms = System.currentTimeMillis() - t;
                    event("loaded", ms + "," + engine.describe());
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("failed", String.valueOf(ex));
                }
        }, "web-loadGame").start();
    }

    @JSExport
    public static void connect() {
        engine.connect();
    }

    @JSExport
    public static void receive(String xml) {
        engine.receive(xml);
    }
}
