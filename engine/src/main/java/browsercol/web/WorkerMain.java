package browsercol.web;

import org.teavm.jso.JSBody;
import org.teavm.jso.JSExport;
import org.teavm.jso.typedarrays.Int8Array;


/**
 * Entry point of the server module, which runs in the Worker. The Worker
 * script (ui/src/worker.ts) calls the exports and provides fcPost and
 * fcServerEvent.
 */
public final class WorkerMain {

    private static ServerEngine engine;

    @JSBody(params = "xml", script = "fcPost(xml);")
    private static native void post(String xml);

    @JSBody(params = { "name", "detail" }, script = "fcServerEvent(name, detail);")
    private static native void event(String name, String detail);

    /**
     * Set the language of FreeCol's text (Language.set), before main: the
     * page has put that translation's strings in the data bundle.
     */
    @JSExport
    public static void setLanguage(String id) {
        Language.set(id);
    }

    /** Load the data files: (path, text) pairs. */
    public static void main(String[] args) {
        Failures.reportTo((what, detail) -> event("error", what + "\n" + detail));
        try {
            DataFiles.write(args);
        } catch (Exception ex) {
            event("failed", Failures.describe(ex));
            return;
        }
        engine = new ServerEngine(WorkerMain::post);
    }

    /**
     * Start a new game from a preset's JSON ("" for none), then report
     * "started" with the time it took.
     *
     * @param importMap The bytes of a map or savegame file to take the
     *     map from (the map generator's import file option); empty for a
     *     generated map.
     */
    @JSExport
    public static void startGame(String rules, String preset, Int8Array importMap) {
        final byte[] map = importMap.copyToJavaArray();
        new Thread(() -> {
                long t = System.currentTimeMillis();
                try {
                    engine.startGame(rules, (preset.isEmpty()) ? GamePreset.none()
                        : GamePreset.parse(preset), map);
                    event("started", String.valueOf(System.currentTimeMillis() - t));
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("failed", Failures.describe(ex));
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
                    event("saveFailed", Failures.describe(ex));
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
                    // The client logs in under the save's owner.
                    String owner = engine.ownerName();
                    event("owner", owner == null ? "" : owner);
                    long ms = System.currentTimeMillis() - t;
                    event("loaded", ms + "," + engine.describe());
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("failed", Failures.describe(ex));
                }
        }, "web-loadGame").start();
    }

    /**
     * Run a debug action (ServerEngine.debug), then report "debug" with its
     * answer, or "debugFailed" with what was wrong. The page only calls it
     * in debug mode.
     */
    @JSExport
    public static void debug(String request) {
        new Thread(() -> {
                try {
                    event("debug", engine.debug(request));
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("debugFailed", String.valueOf(ex.getMessage()));
                }
        }, "web-debug").start();
    }

    /**
     * Run the preset's setup requests (ServerEngine.setup), once the game
     * has started, reporting "debug" with each answer, or "debugFailed".
     */
    @JSExport
    public static void setup() {
        new Thread(() -> {
                try {
                    for (String answer : engine.setup()) event("debug", answer);
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("debugFailed", String.valueOf(ex.getMessage()));
                }
        }, "web-setup").start();
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
