package online.freecol.web;

import java.util.concurrent.atomic.AtomicBoolean;

import org.teavm.jso.JSBody;
import org.teavm.jso.JSExport;

import net.sf.freecol.common.model.Game;


/**
 * Entry point of the client module, which runs on the main thread. The
 * page script (ui/src/channel.ts) calls the exports and provides
 * fcToServer, fcConnect, fcClientEvent, and the WebGUI's fcShow and fcAsk.
 */
public final class ClientMain {

    private static ClientEngine engine;
    /** A player command is running; input meanwhile is dropped. */
    private static final AtomicBoolean busy = new AtomicBoolean(false);

    @JSBody(params = "xml", script = "fcToServer(xml);")
    private static native void toServer(String xml);

    @JSBody(script = "fcConnect();")
    private static native void connectToServer();

    @JSBody(params = { "name", "detail" }, script = "fcClientEvent(name, detail);")
    private static native void event(String name, String detail);

    @JSBody(params = { "kind", "json" }, script = "fcShow(kind, json);")
    private static native void show(String kind, String json);

    @JSBody(params = { "id", "kind", "json" }, script = "fcAsk(id, kind, json);")
    private static native void ask(int id, String kind, String json);

    /** Load the data files, (path, text) pairs, and make the client. */
    public static void main(String[] args) {
        new Thread(() -> {
                try {
                    DataFiles.write(args);
                    engine = new ClientEngine(new ClientEngine.ServerLink() {
                            public void connect() { connectToServer(); }
                            public void post(String xml) { toServer(xml); }
                        }, new ClientEngine.Listener() {
                            public void gameStarted(Game game) {
                                event("gameStarted", mapJson());
                            }
                            public void roundDone(int round, long millis) {
                                event("round", round + "," + millis);
                                event("map", mapJson());
                            }
                            public void finished(Game game) {
                                event("finished", String.valueOf(game.getTurn()));
                            }
                        }, new WebGUI.BrowserUI() {
                            public void show(String kind, String json) {
                                ClientMain.show(kind, json);
                                // A new active unit or a refresh, e.g. when
                                // play comes back with or without one.
                                if ("activeUnit".equals(kind) || "refresh".equals(kind)) {
                                    event("map", mapJson());
                                }
                            }
                            public void ask(int id, String kind, String json) {
                                ClientMain.ask(id, kind, json);
                            }
                        });
                    event("ready", "");
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("failed", String.valueOf(ex));
                }
        }, "web-client").start();
    }

    /** Log in to the Worker's game, launch it and run AI rounds. */
    @JSExport
    public static void startGame(int rounds) {
        new Thread(() -> {
                try {
                    if (!engine.startGame(rounds)) event("failed", "login");
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("failed", String.valueOf(ex));
                }
        }, "web-login").start();
    }

    @JSExport
    public static void receive(String xml) {
        engine.receive(xml);
    }

    /** The Browser UI's answer to a WebGUI question; null for a closed dialog. */
    @JSExport
    public static void answer(int id, String answer) {
        engine.answer(id, answer);
    }

    /**
     * Run a player command off the page's event loop, then send the map.
     * Input that arrives while one runs is dropped.
     */
    private static void command(String name, Runnable run) {
        if (!busy.compareAndSet(false, true)) return;
        new Thread(() -> {
                try {
                    run.run();
                    event("map", mapJson());
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("commandFailed", name + ": " + ex);
                } finally {
                    busy.set(false);
                }
        }, "web-" + name).start();
    }

    /** Select our unit on a tile, or send the active unit there. */
    @JSExport
    public static void click(int x, int y) {
        command("click", () -> engine.getCommands().click(x, y));
    }

    /** Move the active unit one step; a Direction name, e.g. "NE". */
    @JSExport
    public static void move(String direction) {
        command("move", () -> engine.getCommands().move(direction));
    }

    @JSExport
    public static void nextUnit() {
        command("nextUnit", () -> engine.getCommands().nextUnit());
    }

    /** Fortify the active unit (FortifyAction). */
    @JSExport
    public static void fortify() {
        command("fortify", () -> engine.getCommands().fortify());
    }

    /** Sentry the active unit (SentryAction). */
    @JSExport
    public static void sentry() {
        command("sentry", () -> engine.getCommands().sentry());
    }

    /** Leave the active unit for this turn (SkipUnitAction). */
    @JSExport
    public static void skip() {
        command("skip", () -> engine.getCommands().skip());
    }

    /** Disband the active unit (DisbandUnitAction). */
    @JSExport
    public static void disband() {
        command("disband", () -> engine.getCommands().disband());
    }

    /** Plow the active unit's tile (the plow ImprovementAction). */
    @JSExport
    public static void plow() {
        command("plow", () -> engine.getCommands().plow());
    }

    /** Clear the forest on the active unit's tile (the clearForest ImprovementAction). */
    @JSExport
    public static void clearForest() {
        command("clearForest", () -> engine.getCommands().clearForest());
    }

    /** Build a road on the active unit's tile (the road ImprovementAction). */
    @JSExport
    public static void road() {
        command("road", () -> engine.getCommands().road());
    }

    @JSExport
    public static void buildColony() {
        command("buildColony", () -> engine.getCommands().buildColony());
    }

    @JSExport
    public static void endTurn() {
        command("endTurn", () -> engine.getCommands().endTurn());
    }

    /** The client's view of the map for Tileset mode: see MapJson. */
    static String mapJson() {
        return MapJson.of(engine.getGame(), engine.getClient().getMyPlayer(),
                          engine.getClient().getGUI().getActiveUnit());
    }
}
