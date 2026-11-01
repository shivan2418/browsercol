package online.freecol.web;

import java.util.concurrent.atomic.AtomicBoolean;

import org.teavm.jso.JSBody;
import org.teavm.jso.JSExport;

import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Unit;


/**
 * Entry point of the client module, which runs on the main thread. The
 * page script (ui/src/channel.ts) calls the exports and provides
 * fcToServer, fcConnect, fcClientEvent, and the WebGUI's fcShow and fcAsk.
 *
 * The map goes out with the gameStarted event, after every player command,
 * and when a refresh or a new active unit asks for it outside a command.
 * An updated event follows each message from the server once it is handled.
 */
public final class ClientMain {

    private static ClientEngine engine;
    /** A player command is running; input meanwhile is dropped. */
    private static final AtomicBoolean busy = new AtomicBoolean(false);
    /** A refresh came while a command ran: the map must go out again after it. */
    private static final AtomicBoolean refreshPending = new AtomicBoolean(false);

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
                            public void updated() {
                                // The open colony panels are pulled again (ui/src/main.tsx).
                                event("updated", "");
                            }
                        }, new WebGUI.BrowserUI() {
                            public void show(String kind, String json) {
                                ClientMain.show(kind, json);
                                // A new active unit or a refresh, e.g. when
                                // play comes back with or without one.
                                if ("activeUnit".equals(kind) || "refresh".equals(kind)) {
                                    if (busy.get()) {
                                        // A command runs: its own map event
                                        // follows, and covers this one.
                                        refreshPending.set(true);
                                    } else {
                                        event("map", mapJson());
                                    }
                                }
                            }
                            public void ask(int id, String kind, String json) {
                                ClientMain.ask(id, kind, json);
                            }
                        });
                    event("ready", "");
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("failed", Failures.describe(ex));
                }
        }, "web-client").start();
    }

    /**
     * Log in to the Worker's game, launch it and run AI rounds.
     *
     * @param name The player's name: the owner of a loaded game; empty for a new one.
     */
    @JSExport
    public static void startGame(int rounds, String name) {
        new Thread(() -> {
                try {
                    if (!engine.startGame(rounds, name)) event("failed", "login");
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("failed", Failures.describe(ex));
                }
        }, "web-login").start();
    }

    /**
     * The id of the active unit, for a save request to carry to the
     * server Engine, as desktop's InGameController.saveGame passes it.
     *
     * @return The id, or "" if there is none.
     */
    @JSExport
    public static String activeUnitId() {
        Unit u = engine.getClient().getGUI().getActiveUnit();
        return (u == null) ? "" : u.getId();
    }

    /**
     * Our colony with this id as the colony panel shows it (ColonyJson),
     * for the Browser UI to show it again as it changes.
     *
     * @return The JSON, or "null" if there is no such colony of ours now.
     */
    @JSExport
    public static String colony(String id) {
        final Colony colony = engine.getGame().getFreeColGameObject(id, Colony.class);
        if (colony == null || colony.isDisposed()
            || !engine.getClient().getMyPlayer().owns(colony)) return "null";
        return ((WebGUI)engine.getClient().getGUI()).colonyJson(colony);
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
     * Group the turn report as the group by client option says: 0 as it
     * comes, 1 by type, 2 by source. The report is shown again, regrouped.
     */
    @JSExport
    public static void reportGroupBy(int value) {
        engine.reportGroupBy(value);
    }

    /** Show (or not) the type of the turn report's message at an index. */
    @JSExport
    public static void reportFilter(int index, boolean shown) {
        engine.reportFilter(index, shown);
    }

    /** Ignore the turn report's message at an index, or stop ignoring it. */
    @JSExport
    public static void reportIgnore(int index, boolean ignore) {
        engine.reportIgnore(index, ignore);
    }

    /**
     * Run a player command off the page's event loop, then send the map.
     * Input that arrives while one runs is dropped.
     *
     * The map goes out once, after the command: the page reads a map as
     * the end of a command, and a map from the middle of one would show it
     * a state the command has left behind.
     */
    private static void command(String name, Runnable run) {
        if (!busy.compareAndSet(false, true)) return;
        new Thread(() -> {
                try {
                    run.run();
                    // The map after the command covers any refresh that came
                    // while it ran.
                    refreshPending.set(false);
                    event("map", mapJson());
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("commandFailed", name + ": " + ex);
                } finally {
                    busy.set(false);
                    // A refresh that came after the command's map: send the
                    // map again, as it may be newer.
                    if (refreshPending.getAndSet(false)) event("map", mapJson());
                }
        }, "web-" + name).start();
    }

    /**
     * Debug mode: skip turns with the AI playing (ClientEngine.skipTurns).
     * Each AI round sends "round" and "map" events, and "finished" when
     * play comes back.
     */
    @JSExport
    public static void skipTurns(int rounds) {
        new Thread(() -> {
                try {
                    engine.skipTurns(rounds);
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("commandFailed", "skipTurns: " + ex);
                }
        }, "web-skipTurns").start();
    }

    /**
     * Debug mode: the server has done a debug action (its "debug" event);
     * take the client's part of it, then send the map.
     */
    @JSExport
    public static void debugApplied(String answer) {
        new Thread(() -> {
                try {
                    engine.debugApplied(answer);
                    event("map", mapJson());
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("commandFailed", "debug: " + ex);
                }
        }, "web-debugApplied").start();
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

    /** Show the Europe panel (EuropeAction). */
    @JSExport
    public static void showEurope() {
        command("showEurope", () -> engine.getCommands().showEurope());
    }

    /** Declare independence (DeclareIndependenceAction). */
    @JSExport
    public static void declareIndependence() {
        command("declareIndependence", () -> engine.getCommands().declareIndependence());
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

    /** Send the active unit to a destination (GotoAction). */
    @JSExport
    public static void selectDestination() {
        command("selectDestination",
                () -> engine.getCommands().selectDestination());
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

    /** Put a colonist to work at a building or colony tile, by ids (the colony panel's drop). */
    @JSExport
    public static void work(String unitId, String locationId) {
        command("work", () -> engine.getCommands().work(unitId, locationId));
    }

    /** Put a colonist outside the colony, by id (the colony panel's outside box). */
    @JSExport
    public static void putOutsideColony(String unitId) {
        command("putOutsideColony", () -> engine.getCommands().putOutsideColony(unitId));
    }

    /** Change the goods a colonist produces where it works, by ids. */
    @JSExport
    public static void changeWorkType(String unitId, String goodsTypeId) {
        command("changeWorkType", () -> engine.getCommands().changeWorkType(unitId, goodsTypeId));
    }

    @JSExport
    public static void buildColony() {
        command("buildColony", () -> engine.getCommands().buildColony());
    }

    @JSExport
    public static void endTurn() {
        command("endTurn", () -> engine.getCommands().endTurn());
    }

    /** Open a report of the Report menu: colony, labour or compactLabour (Commands.showReport). */
    @JSExport
    public static void report(String name) {
        command("report", () -> engine.getCommands().showReport(name));
    }

    /** Open the details a report links to (Commands.showReportDetail). */
    @JSExport
    public static void reportDetail(String name, String id) {
        command("reportDetail", () -> engine.getCommands().showReportDetail(name, id));
    }

    /** Open one of our colonies' panels, as a link in a report does. */
    @JSExport
    public static void showColony(String id) {
        command("showColony", () -> engine.getCommands().showColony(id));
    }

    /** Open the trade routes panel (TradeRouteAction). */
    @JSExport
    public static void tradeRoutes() {
        command("tradeRoutes", () -> engine.getCommands().tradeRoutes());
    }

    /**
     * Create or change a trade route.
     *
     * @param json {id (null for a new route), name, silent, stops: [{place,
     *     cargo: [goods type id]}]}
     */
    @JSExport
    public static void saveTradeRoute(String json) {
        command("saveTradeRoute", () -> {
                final java.util.Map<?, ?> r = (java.util.Map<?, ?>)JsonReader.read(json);
                final java.util.List<String> places = new java.util.ArrayList<>();
                final java.util.List<java.util.List<String>> cargo = new java.util.ArrayList<>();
                for (Object o : (java.util.List<?>)r.get("stops")) {
                    final java.util.Map<?, ?> stop = (java.util.Map<?, ?>)o;
                    places.add((String)stop.get("place"));
                    final java.util.List<String> goods = new java.util.ArrayList<>();
                    for (Object g : (java.util.List<?>)stop.get("cargo")) goods.add((String)g);
                    cargo.add(goods);
                }
                engine.getCommands().saveTradeRoute((String)r.get("id"),
                    (String)r.get("name"), Boolean.TRUE.equals(r.get("silent")),
                    places, cargo);
        });
    }

    /** Delete a trade route, by its id. */
    @JSExport
    public static void deleteTradeRoute(String id) {
        command("deleteTradeRoute", () -> engine.getCommands().deleteTradeRoute(id));
    }

    /** The client's view of the map for Tileset mode: see MapJson. */
    static String mapJson() {
        return MapJson.of(engine.getGame(), engine.getClient().getMyPlayer(),
                          engine.getClient().getGUI().getActiveUnit());
    }
}
