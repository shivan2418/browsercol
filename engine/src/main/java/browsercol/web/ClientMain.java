package browsercol.web;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import org.teavm.jso.JSBody;
import org.teavm.jso.JSExport;
import org.teavm.jso.core.JSArray;
import org.teavm.jso.core.JSString;

import net.sf.freecol.client.ClientOptions;
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
    /**
     * Client options the page set before the engine was made: the page sets
     * the player's as the module loads, and the engine comes later, on its
     * own thread. They are set on the engine once it is made.
     */
    private static final java.util.Map<String, String> earlyOptions = new java.util.LinkedHashMap<>();
    /**
     * The player's commands: one at a time, in the order they came. A command
     * that comes while another runs waits its turn, instead of being lost.
     */
    private static final CommandQueue commands = new CommandQueue(ClientMain::queueIdle);
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

    /**
     * Set the language of FreeCol's text (Language.set), before main: the
     * page has put that translation's strings in the data bundle.
     */
    @JSExport
    public static void setLanguage(String id) {
        Language.set(id);
    }

    /** The data files are in the file system, written by {@link #colopedia} or {@link #main}. */
    private static boolean dataWritten = false;

    /** Write the data files once, whichever of colopedia and main comes first. */
    private static synchronized void writeData(String[] files) throws java.io.IOException {
        if (dataWritten) return;
        DataFiles.write(files);
        dataWritten = true;
    }

    @JSBody(params = { "json", "error" }, script = "fcColopedia(json, error);")
    private static native void colopediaDone(String json, String error);

    /**
     * The Colopedia before a game (Colopedia.before), for the start screen's
     * Nation and Advantage buttons: no client Engine is made. Called after
     * setLanguage, instead of or before main. It reads the rules on a thread of
     * its own and then calls fcColopedia(json, error): the Colopedia report as
     * {@link Reports#colopedia} gives it, or null and what went wrong.
     *
     * @param data The data files, as for main.
     * @param rules The rules id, e.g. "classic".
     * @param select The entry to open on; empty for none.
     */
    @JSExport
    public static void colopedia(JSArray<JSString> data, String rules, String select) {
        final String[] files = new String[data.getLength()];
        for (int i = 0; i < files.length; i++) files[i] = data.get(i).stringValue();
        new Thread(() -> {
                try {
                    writeData(files);
                    final String json = Colopedia.before(rules, select.isEmpty() ? null : select);
                    if (json == null) throw new IllegalArgumentException("Unknown rules \"" + rules + "\"");
                    colopediaDone(json, null);
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    colopediaDone(null, Failures.describe(ex));
                }
        }, "web-colopedia").start();
    }

    /** Load the data files, (path, text) pairs, and make the client. */
    public static void main(String[] args) {
        Failures.reportTo((what, detail) -> event("error", what + "\n" + detail));
        new Thread(() -> {
                try {
                    writeData(args);
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
                                    if (commands.busy()) {
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
                    synchronized (earlyOptions) {
                        for (java.util.Map.Entry<String, String> e : earlyOptions.entrySet()) {
                            engine.setClientOption(e.getKey(), e.getValue());
                        }
                        earlyOptions.clear();
                    }
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

    /** The values of FreeCol's client options, by id, as JSON (ClientEngine.clientOptionValues). */
    @JSExport
    public static String clientOptionValues() {
        return (engine == null) ? "{}" : engine.clientOptionValues();
    }

    /** Set one of FreeCol's client options: "true", "false" or a whole number. Returns whether it took. */
    @JSExport
    public static boolean setClientOption(String id, String value) {
        synchronized (earlyOptions) {
            if (engine == null) {
                earlyOptions.put(id, value);
                return true;
            }
        }
        return engine.setClientOption(id, value);
    }

    /** Send the map again, as an option that changes it (display fog of war) asks. */
    @JSExport
    public static void refreshMap() {
        if (engine != null && engine.getGame() != null) command("refreshMap", () -> {});
    }

    /** Ignore the turn report's message at an index, or stop ignoring it. */
    @JSExport
    public static void reportIgnore(int index, boolean ignore) {
        engine.reportIgnore(index, ignore);
    }

    /**
     * Run a player command off the page's event loop, then send the map.
     * A command that comes while another runs waits its turn, and runs after
     * it.
     *
     * The map goes out once, after the command: the page reads a map as
     * the end of a command, and a map from the middle of one would show it
     * a state the command has left behind.
     */
    private static void command(String name, Runnable run) {
        commands.add(() -> {
                try {
                    run.run();
                    engine.getCommands().afterCommand();
                    // The map after the command covers any refresh that came
                    // while it ran.
                    refreshPending.set(false);
                    event("map", mapJson());
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("commandFailed", name + ": " + Failures.describe(ex));
                }
        });
    }

    /**
     * The commands are done: a refresh that came after the last command's map
     * asked for the map again, as it may be newer.
     */
    private static void queueIdle() {
        if (refreshPending.getAndSet(false)) event("map", mapJson());
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
                    event("commandFailed", "skipTurns: " + Failures.describe(ex));
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
                    event("commandFailed", "debug: " + Failures.describe(ex));
                }
        }, "web-debugApplied").start();
    }

    /**
     * Debug mode: one of the client's own debug tools (ClientEngine.debugClient).
     * It reads or shows what the client has and answers at once; a request that
     * fails throws, for the page to show.
     */
    @JSExport
    public static String debugClient(String request) {
        return engine.debugClient(request);
    }

    /** Click a tile (Commands.click); count is the click count, 2 for a double click. */
    @JSExport
    public static void click(int x, int y, int count) {
        command("click", () -> engine.getCommands().click(x, y, count));
    }

    /** Send the active unit to a tile along its best path. */
    @JSExport
    public static void goTo(int x, int y) {
        command("goTo", () -> engine.getCommands().goTo(x, y));
    }

    /** The path the active unit would take to a tile, as JSON [x, y, turns] per step, or "null". */
    @JSExport
    public static String pathTo(int x, int y) {
        return engine.getCommands().pathTo(x, y);
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

    /** Open the Find Settlement panel (FindSettlementAction). */
    @JSExport
    public static void findSettlement() {
        command("findSettlement", () -> engine.getCommands().findSettlement());
    }

    /** Show the game options, read-only (ShowGameOptionsAction). */
    @JSExport
    public static void showGameOptions() {
        command("showGameOptions", () -> engine.getCommands().showGameOptions());
    }

    /** Show the map generator options, read-only (ShowMapGeneratorOptionsAction). */
    @JSExport
    public static void showMapGeneratorOptions() {
        command("showMapGeneratorOptions", () -> engine.getCommands().showMapGeneratorOptions());
    }

    /** Show the game's difficulty level, read-only (ShowDifficultyAction). */
    @JSExport
    public static void showDifficulty() {
        command("showDifficulty", () -> engine.getCommands().showDifficulty());
    }

    /** Europe panel: recruit the unit at an index of the docks. */
    @JSExport
    public static void recruitUnit(int index) {
        command("recruitUnit", () -> engine.getCommands().recruitUnit(index));
    }

    /** Europe panel: train or buy a unit of a type, by id. */
    @JSExport
    public static void trainUnit(String unitTypeId) {
        command("trainUnit", () -> engine.getCommands().trainUnit(unitTypeId));
    }

    /** Europe and colony panels: put a unit aboard a ship beside it, by ids. */
    @JSExport
    public static void boardShip(String unitId, String shipId) {
        command("boardShip", () -> engine.getCommands().boardShip(unitId, shipId));
    }

    /** Europe panel: buy goods of a type onto a ship in port, by ids; ask asks the amount, else the most. */
    @JSExport
    public static void buyGoods(String shipId, String goodsTypeId, boolean ask) {
        command("buyGoods", () -> engine.getCommands().buyGoods(shipId, goodsTypeId, ask));
    }

    /** Europe panel: sell a ship's cargo in Europe, by ids; ask asks the amount, else the stack (all of the type for stack 0). */
    @JSExport
    public static void sellGoods(String shipId, String goodsTypeId, boolean ask, int stack) {
        command("sellGoods", () -> engine.getCommands().sellGoods(shipId, goodsTypeId, ask, stack));
    }

    /** Europe panel: move goods between two ships in port, by ids; stack 0 for all of the type. */
    @JSExport
    public static void transferGoods(String fromShipId, String toShipId, String goodsTypeId, int stack) {
        command("transferGoods", () -> engine.getCommands().transferGoods(fromShipId, toShipId, goodsTypeId, stack));
    }

    /** Europe panel: turn a ship on the high seas around, by id. */
    @JSExport
    public static void redirectShip(String shipId, boolean toEurope) {
        command("redirectShip", () -> engine.getCommands().redirectShip(shipId, toEurope));
    }

    /** Europe panel: send a ship in port to the New World, by id. */
    @JSExport
    public static void sailToNewWorld(String shipId) {
        command("sailToNewWorld", () -> engine.getCommands().sailToNewWorld(shipId));
    }

    /** Declare independence (DeclareIndependenceAction). */
    @JSExport
    public static void declareIndependence() {
        command("declareIndependence", () -> engine.getCommands().declareIndependence());
    }

    /** Retire from the game (RetireAction). */
    @JSExport
    public static void retire() {
        command("retire", () -> engine.getCommands().retire());
    }

    /** Show the high score table (ReportHighScoresAction). */
    @JSExport
    public static void showHighScores() {
        command("showHighScores", () -> engine.getCommands().showHighScores());
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

    /** Unload the active carrier's cargo (UnloadAction). */
    @JSExport
    public static void unload() {
        command("unload", () -> engine.getCommands().unload());
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

    /** Colony panel: goods of the warehouse dropped on a colonist equip it with the role they give. */
    @JSExport
    public static void equipUnit(String unitId, String goodsTypeId) {
        command("equipUnit", () -> engine.getCommands().equip(unitId, goodsTypeId));
    }

    /** Colony panel: take a unit off a ship in port, by id. */
    @JSExport
    public static void leaveShip(String unitId) {
        command("leaveShip", () -> engine.getCommands().leaveShip(unitId));
    }

    /** Colony panel: load goods of a type from the warehouse onto a ship in port; ask asks the amount. */
    @JSExport
    public static void loadGoods(String shipId, String goodsTypeId, boolean ask) {
        command("loadGoods", () -> engine.getCommands().loadGoods(shipId, goodsTypeId, ask));
    }

    /** Colony panel: unload a stack of a ship's goods into the warehouse; ask asks the amount. */
    @JSExport
    public static void unloadGoods(String shipId, String goodsTypeId, int stack, boolean ask) {
        command("unloadGoods", () -> engine.getCommands().unloadGoods(shipId, goodsTypeId, stack, ask));
    }

    /** Set a colony's build queue: the ids of what to build, in order, joined by commas. */
    @JSExport
    public static void setBuildQueue(String colonyId, String typeIds) {
        command("setBuildQueue", () -> engine.getCommands().setBuildQueue(colonyId,
            typeIds.isEmpty() ? List.of() : List.of(typeIds.split(","))));
    }

    /** Close a colony's panel and open the previous or next colony's (Commands.stepColony). */
    @JSExport
    public static void stepColony(String colonyId, int by) {
        command("stepColony", () -> engine.getCommands().stepColony(colonyId, by));
    }

    /** Open a colony's warehouse dialog. */
    @JSExport
    public static void warehouse(String colonyId) {
        command("warehouse", () -> engine.getCommands().warehouse(colonyId));
    }

    /** Close a colony's panel, asking first whether to abandon an empty colony (Commands.closeColonyPanel). */
    @JSExport
    public static void closeColonyPanel(String colonyId) {
        command("closeColonyPanel", () -> engine.getCommands().closeColonyPanel(colonyId));
    }

    /** Pay for what a colony is building now. */
    @JSExport
    public static void payForBuilding(String colonyId) {
        command("payForBuilding", () -> engine.getCommands().payForBuilding(colonyId));
    }

    @JSExport
    public static void buildColony() {
        command("buildColony", () -> engine.getCommands().buildColony());
    }

    @JSExport
    public static void endTurn() {
        command("endTurn", () -> engine.getCommands().endTurn());
    }

    /** Open a report of the Report menu: colony, labour, compactLabour, military, naval or cargo (Commands.showReport). */
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

    /**
     * The menu for a right-click on a tile (Menus.tile).
     *
     * @return The menu's JSON, or "null" for none.
     */
    @JSExport
    public static String tileMenu(int x, int y) {
        return engine.getMenus().tile(x, y);
    }

    /**
     * The debug entries of a tile's popup (Menus.debugTile), as a menu's JSON or "null". The page asks
     * in debug mode and adds them to the tile's menu.
     */
    @JSExport
    public static String debugTileMenu(int x, int y) {
        return engine.getMenus().debugTile(x, y);
    }

    /** TilePopup's "Show search": the active unit's path search to the tile, as text (Menus.debugSearch). */
    @JSExport
    public static String debugSearch(int x, int y) {
        return engine.getMenus().debugSearch(x, y);
    }

    /**
     * The debug menu's "Show colony value": the tile panel then shows what the player would think of founding a
     * colony on the tile (TileJson), as FreeColDebugger.setDebugDisplayColonyValuePlayer does.
     *
     * @param playerId The player's id, or "" for none.
     */
    @JSExport
    public static void showColonyValue(String playerId) {
        engine.setColonyValuePlayer(playerId);
    }

    /** The quick action menu of one of our colonists or ships (Menus.unit), as JSON or "null". */
    @JSExport
    public static String unitMenu(String unitId) {
        return engine.getMenus().unit(unitId);
    }

    /** The menu of a tile in the colony panel's grid (Menus.colonyTile), as JSON or "null". */
    @JSExport
    public static String colonyTileMenu(int x, int y) {
        return engine.getMenus().colonyTile(x, y);
    }

    /** The quick action menu of goods in a colony or on a ship (Menus.goods), as JSON or "null". */
    @JSExport
    public static String goodsMenu(String locationId, String goodsTypeId, int amount) {
        return engine.getMenus().goods(locationId, goodsTypeId, amount);
    }

    /** Run the entry picked in a menu (Commands.menuEntry). */
    @JSExport
    public static void menuEntry(String id) {
        command("menuEntry", () -> engine.getCommands().menuEntry(id));
    }

    /** Rename the active unit (RenameAction); the player is asked for the name. */
    @JSExport
    public static void renameUnit() {
        command("renameUnit", () -> engine.getCommands().renameUnit());
    }

    /** Move every unit with goto orders (ExecuteGotoOrdersAction). */
    @JSExport
    public static void executeGotoOrders() {
        command("executeGotoOrders", () -> engine.getCommands().executeGotoOrders());
    }

    /** Show this turn's report again (ReportTurnAction). */
    @JSExport
    public static void showTurnReport() {
        command("showTurnReport", () -> engine.getCommands().showTurnReport());
    }

    /** The menu of a colony's units, which the C key opens (Menus.colonyUnits), as JSON or "null". */
    @JSExport
    public static String colonyUnitsMenu(String colonyId) {
        return engine.getMenus().colonyUnits(colonyId);
    }

    /** Open the trade routes panel for the active carrier (AssignTradeRouteAction). */
    @JSExport
    public static void assignRoute() {
        command("assignRoute", () -> engine.getCommands().assignRoute());
    }

    /** Open the trade routes panel with no unit (TradeRouteAction). */
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
                    places, cargo, (String)r.get("unit"));
        });
    }

    /** Assign a unit to a trade route; an empty route id drops its route. */
    @JSExport
    public static void assignTradeRoute(String unitId, String routeId) {
        command("assignTradeRoute", () -> engine.getCommands()
                .assignTradeRoute(unitId, routeId.isEmpty() ? null : routeId));
    }

    /** Assign a unit to a trade route as the panel's OK does: the panel is not sent again. */
    @JSExport
    public static void confirmTradeRoute(String unitId, String routeId) {
        command("assignTradeRoute", () -> engine.getCommands()
                .assignTradeRoute(unitId, routeId, false));
    }

    /** Delete a trade route, by its id. */
    @JSExport
    public static void deleteTradeRoute(String id) {
        command("deleteTradeRoute", () -> engine.getCommands().deleteTradeRoute(id));
    }

    /** The client's view of the map for Tileset mode: see MapJson. */
    static String mapJson() {
        return MapJson.of(engine.getGame(), engine.getClient().getMyPlayer(),
                          engine.getClient().getGUI().getActiveUnit(),
                          engine.getClient().getClientOptions()
                              .getBoolean(ClientOptions.DISPLAY_FOG_OF_WAR));
    }
}
