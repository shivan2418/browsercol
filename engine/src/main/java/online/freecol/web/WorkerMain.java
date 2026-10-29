package online.freecol.web;

import org.teavm.jso.JSBody;
import org.teavm.jso.JSExport;


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

    @JSExport
    public static void connect() {
        engine.connect();
    }

    @JSExport
    public static void receive(String xml) {
        engine.receive(xml);
    }
}
