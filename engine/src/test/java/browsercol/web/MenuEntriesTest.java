package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;


/**
 * Every entry of the colonist and goods menus of the colony panel and the
 * Europe panel does what it says: picking it changes the game, on the
 * client as on the server, and in Europe the panel is sent again so the
 * Browser UI shows the change. Each entry the menus offer is picked once
 * (an entry is told apart by its verb and what it names other than the
 * units, so each role, state and job is picked), and every kind of entry
 * must have been offered.
 */
class MenuEntriesTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final ExecutorService ui = Executors.newSingleThreadExecutor();

    /** The ids of a menu's entries that can be picked. */
    private static final Pattern ENTRY =
        Pattern.compile("\"id\":\"([^\"]*)\",\"label\":\"(?:[^\"\\\\]|\\\\.)*\",\"enabled\":true");
    private static final Pattern CHOICES = Pattern.compile("\"choices\":\\[(.*)]");
    private static final Pattern TEXT = Pattern.compile("\"text\":\"((?:[^\"\\\\]|\\\\.)*)\"");
    /** A game object's id in an entry, as unit:123. */
    private static final Pattern OBJECT_ID = Pattern.compile("[A-Za-z]+:\\d+");

    /** Entries that only show something or select a unit: the game does not change. */
    private static final Set<String> LOOKS = Set.of("none", "select", "colony",
        "settlement", "tile", "colopedia", "goto", "attack", "europe", "activateAll", "production");

    private final List<String> asked = Collections.synchronizedList(new ArrayList<>());
    private final List<String> shown = Collections.synchronizedList(new ArrayList<>());
    /** The destination the fake Browser UI picks, while sailing to Europe. */
    private volatile String wanted = null;

    private ServerEngine server;
    private ClientEngine client;

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        ui.shutdownNow();
        // JUnit keeps each test's instance to the end of the run: let its game go.
        server = null;
        client = null;
    }

    /**
     * The fake Browser UI says yes to every confirmation but sailing to
     * Europe on its own, takes ten of any amount, and picks the wanted
     * destination, else the first choice.
     */
    private String answer(String kind, String json) {
        switch (kind) {
        case "choice": {
            // With no destination wanted, the first choice: a claim on native land takes it.
            if (wanted == null) return "0";
            final List<String> texts = new ArrayList<>();
            final Matcher c = CHOICES.matcher(json);
            if (c.find()) {
                final Matcher t = TEXT.matcher(c.group(1));
                while (t.find()) texts.add(t.group(1));
            }
            final int i = texts.indexOf(wanted);
            if (i < 0) fail("no choice " + wanted + " in " + texts);
            return String.valueOf(i);
        }
        case "endTurn": return "ok";
        case "confirm": return json.contains("high seas") ? "false" : "true";
        case "amount": return "10";
        default: return null;
        }
    }

    private void startGame() throws Exception {
        final CountDownLatch ourTurn = new CountDownLatch(1);
        server = new ServerEngine(xml -> toClient.execute(() -> client.receive(xml)));
        client = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) {
                    toServer.execute(() -> server.receive(xml));
                }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) {}
                public void roundDone(int round, long millis) {}
                public void finished(Game game) { ourTurn.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) {
                    shown.add(kind + " " + json);
                }
                public void ask(int id, String kind, String json) {
                    asked.add(kind + " " + json);
                    ui.execute(() -> client.answer(id, answer(kind, json)));
                }
            });
        server.startGame("classic");
        assertTrue(client.startGame(0), "login");
        ourTurn.await();
    }

    private Player me() {
        return client.getClient().getMyPlayer();
    }

    private Player serverMe() {
        return server.getGame().getFreeColGameObject(me().getId(), Player.class);
    }

    /** Run a debug action on the server and take its answer on the client, as the debug menu does. */
    private String debug(String request) {
        final String answer = server.debug(request);
        client.debugApplied(answer);
        return answer;
    }

    /** The id a debug action's answer names under a key. */
    private static String idIn(String answer, String key) {
        final Matcher m = Pattern.compile("\"" + key + "\":\"([^\"]*)\"").matcher(answer);
        assertTrue(m.find(), answer);
        return m.group(1);
    }

    private static void await(BooleanSupplier ok, Supplier<String> what) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(10);
        assertTrue(ok.getAsBoolean(), what);
    }

    /** The client's unit once the server's changes have reached it. */
    private Unit clientUnit(String id) throws InterruptedException {
        await(() -> client.getGame().getFreeColGameObject(id, Unit.class) != null,
            () -> "the client has " + id);
        return client.getGame().getFreeColGameObject(id, Unit.class);
    }

    private Unit active() {
        return client.getClient().getGUI().getActiveUnit();
    }

    /**
     * What a menu entry can change of the player's game, the same on the
     * client and the server once the server's answer is in: each unit's
     * place, type, role, state, work, school and cargo, the colonies'
     * goods, and the gold.
     */
    private static String state(Player player) {
        final StringBuilder s = new StringBuilder("gold " + player.getGold() + "\n");
        for (Unit u : player.getUnits().sorted(Comparator.comparing(Unit::getId))
                 .collect(Collectors.toList())) {
            s.append(u.getId()).append(' ').append(u.getType().getId())
                .append(" at ").append(u.getLocation() == null ? "-" : u.getLocation().getId())
                .append(' ').append(u.getRole().getId()).append('/').append(u.getRoleCount())
                .append(' ').append(u.getState())
                .append(" work ").append(u.getWorkType() == null ? "-" : u.getWorkType().getId())
                .append(" student ").append(u.getStudent() == null ? "-" : u.getStudent().getId())
                .append(" teacher ").append(u.getTeacher() == null ? "-" : u.getTeacher().getId());
            for (Goods g : u.getGoodsList().stream()
                     .sorted(Comparator.comparing(g -> g.getType().getId()))
                     .collect(Collectors.toList())) {
                s.append(' ').append(g.getType().getId()).append('=').append(g.getAmount());
            }
            s.append('\n');
        }
        for (Colony c : player.getColonyList()) {
            s.append(c.getId());
            for (Goods g : c.getCompactGoodsList().stream()
                     .sorted(Comparator.comparing(g -> g.getType().getId()))
                     .collect(Collectors.toList())) {
                s.append(' ').append(g.getType().getId()).append('=').append(g.getAmount());
            }
            s.append('\n');
        }
        return s.toString();
    }

    /** Wait until the client has what the server has. */
    private void sameOnBothSides(String after) throws InterruptedException {
        await(() -> state(me()).equals(state(serverMe())),
            () -> after + ": the client has what the server has\nclient:\n"
                + state(me()) + "server:\n" + state(serverMe()));
    }

    /** The entries of a menu that can be picked; none for "null". */
    private static List<String> entries(String menu) {
        final List<String> ids = new ArrayList<>();
        final Matcher m = ENTRY.matcher(menu);
        while (m.find()) ids.add(m.group(1));
        return ids;
    }

    private static String verb(String entry) {
        final int colon = entry.indexOf(':');
        return colon < 0 ? entry : entry.substring(0, colon);
    }

    /** What tells an entry apart from the same entry for another unit: the entry less its objects' ids. */
    private static String kind(String entry) {
        return OBJECT_ID.matcher(entry).replaceAll("#");
    }

    /**
     * Pick every entry of the menus, once for each kind, until the menus
     * offer no kind not yet picked. The menus are made again after each
     * pick, as the player would see them.
     *
     * @param menus The menus to look through now, as JSON.
     * @param inEurope Whether the entry is picked in the Europe panel, which must be sent again.
     * @return The verbs picked.
     */
    private Set<String> pickEverything(Supplier<List<String>> menus, boolean inEurope)
            throws InterruptedException {
        final Set<String> picked = new LinkedHashSet<>();
        final Set<String> verbs = new TreeSet<>();
        for (int round = 0; round < 50; round++) {
            String next = null;
            for (String menu : menus.get()) {
                for (String e : entries(menu)) {
                    if (LOOKS.contains(verb(e)) || picked.contains(kind(e))) continue;
                    next = e;
                    break;
                }
                if (next != null) break;
            }
            if (next == null) return verbs;
            picked.add(kind(next));
            verbs.add(verb(next));
            pick(next, inEurope);
        }
        fail("the menus still offer new entries after 50 picks: " + picked);
        return verbs;
    }

    /** Pick one entry, and check it changed the game, on both sides, and sent the Europe panel. */
    private void pick(String entry, boolean inEurope) throws InterruptedException {
        final String before = state(me());
        shown.clear();
        asked.clear();
        client.getCommands().menuEntry(entry);
        if (entry.startsWith("state:ACTIVE:")) {
            // Activating a unit that is already active only selects it.
            final String id = entry.substring("state:ACTIVE:".length());
            assertSame(client.getGame().getFreeColGameObject(id, Unit.class), active(),
                entry + " makes the unit the active one");
        } else if (entry.startsWith("tradeRoute:")) {
            // Assigning a route only opens the trade routes panel for the ship.
            assertTrue(new ArrayList<>(shown).stream().anyMatch(s -> s.startsWith("tradeRoutes ")),
                entry + " opens the trade routes panel: " + shown);
            return;
        } else {
            assertNotEquals(before, state(me()),
                entry + " changes the game; asked " + asked);
        }
        sameOnBothSides(entry);
        if (inEurope) {
            assertTrue(new ArrayList<>(shown).stream().anyMatch(s -> s.startsWith("europe ")),
                entry + " sends the Europe panel again: " + shown);
        }
    }

    /** The menus of a colony's goods, and of the goods aboard its ships. */
    private List<String> goodsMenus(Colony colony) {
        final Menus menus = client.getMenus();
        final List<String> all = new ArrayList<>();
        for (Goods g : colony.getCompactGoodsList()) {
            all.add(menus.goods(colony.getId(), g.getType().getId(), g.getAmount()));
        }
        for (Unit ship : colony.getTile().getUnitList()) {
            for (Goods g : ship.getGoodsList()) {
                all.add(menus.goods(ship.getId(), g.getType().getId(), g.getAmount()));
            }
        }
        return all;
    }

    /** A land tile by the sea a colony may be founded on, nearest the player's ship. */
    private Tile coastForAColony() {
        final Player p = serverMe();
        final Tile from = p.getUnits().filter(Unit::isNaval).findFirst().get().getTile();
        return server.getGame().getMap().getTileSet(t -> t.isLand() && t.isCoastland()
                && p.canClaimToFoundSettlement(t))
            .stream().min(Comparator.comparingInt(t -> t.getDistanceTo(from))).orElseThrow();
    }

    @Test
    @Timeout(300)
    void everyColonyMenuEntryChangesTheGame() throws Exception {
        startGame();
        final Tile at = coastForAColony();
        final String xy = "\"x\":" + at.getX() + ",\"y\":" + at.getY();
        final String colonyId = idIn(debug("{\"action\":\"addColony\"," + xy + "}"), "colony");
        debug("{\"action\":\"addGold\",\"amount\":5000}");
        // Colonists, one an expert who can clear his speciality, a ship in port, a treasure
        // train to cash in, and goods to load.
        clientUnit(idIn(debug("{\"action\":\"addUnit\","
            + xy + ",\"type\":\"model.unit.expertFisherman\",\"inColony\":true}"), "unit"));
        clientUnit(idIn(debug("{\"action\":\"addUnit\"," + xy
            + ",\"type\":\"model.unit.freeColonist\",\"inColony\":true}"), "unit"));
        clientUnit(idIn(debug("{\"action\":\"addUnit\"," + xy + ",\"type\":\"model.unit.caravel\"}"), "unit"));
        clientUnit(idIn(debug("{\"action\":\"addUnit\"," + xy + ",\"type\":\"model.unit.treasureTrain\"}"), "unit"));
        debug("{\"action\":\"addGoods\"," + xy + ",\"type\":\"model.goods.furs\",\"amount\":50}");
        debug("{\"action\":\"addGoods\"," + xy + ",\"type\":\"model.goods.tools\",\"amount\":100}");
        debug("{\"action\":\"addGoods\"," + xy + ",\"type\":\"model.goods.muskets\",\"amount\":100}");
        await(() -> client.getGame().getFreeColGameObject(colonyId, Colony.class) != null,
            () -> "the client has the colony");
        final Colony colony = client.getGame().getFreeColGameObject(colonyId, Colony.class);
        await(() -> colony.getGoodsCount(client.getGame().getSpecification()
                .getGoodsType("model.goods.muskets")) >= 100, () -> "the goods arrive");
        sameOnBothSides("the setup");

        final Menus menus = client.getMenus();
        // Classic rules leave the choice of students to the game, so no "assign to teacher"
        // is offered (model.option.allowStudentSelection).
        final Set<String> verbs = new TreeSet<>();
        verbs.addAll(pickEverything(() -> {
            final List<String> all = new ArrayList<>();
            // Those aboard first, before their ship unloads them.
            final List<Unit> units = new ArrayList<>();
            for (Unit u : colony.getTile().getUnitList()) units.addAll(u.getUnitList());
            units.addAll(colony.getUnitList());
            units.addAll(colony.getTile().getUnitList());
            for (Unit u : units) all.add(menus.unit(u.getId()));
            all.addAll(goodsMenus(colony));
            return all;
        }, false));
        assertEquals(new TreeSet<>(List.of("board", "cashin", "clear",
            "clearSpeciality", "leaveShip", "leaveTown", "load", "role", "state",
            "tradeRoute", "unload", "unloadAll", "work")), verbs, "every kind of entry was offered and picked");
        // A tile of the colony's grid offers its panel; a worker's menu lists the tile too.
        final String centre = colony.getTile().getX() + "," + colony.getTile().getY();
        assertTrue(menus.colonyTile(colony.getTile().getX(), colony.getTile().getY())
            .contains("\"id\":\"tile:" + centre + "\""), "the colony tile's menu opens its panel");
        for (Unit u : colony.getUnitList()) {
            if (u.getWorkTile() == null) continue;
            assertTrue(menus.unit(u.getId()).contains("\"id\":\"tile:"
                + u.getWorkTile().getX() + "," + u.getWorkTile().getY() + "\""),
                "a worker's menu lists its tile");
        }
    }

    /** Sail the ship to Europe and wait for it there. */
    private void sailToEurope(Unit ship) throws InterruptedException {
        final Commands commands = client.getCommands();
        if (!ship.getTile().isDirectlyHighSeasConnected()) {
            final Map known = server.getGame().getMap();
            final Tile from = known.getTile(ship.getTile().getX(), ship.getTile().getY());
            final Tile seas = known.getTileSet(t -> t.isDirectlyHighSeasConnected()
                    && t.getUnitCount() == 0)
                .stream().min(Comparator.comparingInt(t -> t.getDistanceTo(from))).orElseThrow();
            for (int i = 0; i < 10 && active() != ship; i++) {
                commands.click(ship.getTile().getX(), ship.getTile().getY());
            }
            assertTrue(commands.goTo(seas.getX(), seas.getY()), "off to the high seas");
            for (int turns = 0; !ship.getTile().isDirectlyHighSeasConnected(); turns++) {
                endTurnAndWait();
                assertTrue(turns < 8, "the ship reaches the high seas; asked " + asked);
            }
        }
        wanted = Messages.message(me().getEurope().getLocationLabelFor(me()));
        assertTrue(client.getClient().getInGameController().selectDestination(ship),
            "the ship sails to Europe");
        wanted = null;
        final Unit serverShip = server.getGame().getFreeColGameObject(ship.getId(), Unit.class);
        for (int turns = 0; !serverShip.isInEurope() || !ship.isInEurope(); turns++) {
            endTurnAndWait();
            assertTrue(turns < 12, "the ship reaches Europe; asked " + asked);
        }
    }

    private void endTurnAndWait() throws InterruptedException {
        final FreeColClient fcc = client.getClient();
        final int turn = client.getGame().getTurn().getNumber();
        assertTrue(client.getCommands().endTurn(), "end turn");
        while (!(fcc.currentPlayerIsMyPlayer()
                 && client.getGame().getTurn().getNumber() > turn)) {
            Thread.sleep(20);
        }
    }

    @Test
    @Timeout(300)
    void everyEuropeMenuEntryChangesTheGameAndTheEuropePanel() throws Exception {
        startGame();
        final Unit ship = me().getUnits().filter(Unit::isNaval).findFirst().orElseThrow();
        sailToEurope(ship);
        debug("{\"action\":\"addGold\",\"amount\":10000}");
        await(() -> me().getGold() >= 10000, () -> "the gold arrives");
        // A recruit and an expert on the docks, beside those the ship brought.
        assertTrue(client.getCommands().recruitUnit(0), "a recruit");
        assertTrue(client.getCommands().trainUnit("model.unit.expertFarmer"), "an expert");
        sameOnBothSides("the setup");
        assertNotNull(me().getEurope());

        final Menus menus = client.getMenus();
        final Set<String> verbs = pickEverything(() -> {
            final List<String> all = new ArrayList<>();
            for (Unit u : me().getEurope().getUnitList()) {
                all.add(menus.unit(u.getId()));
                for (Unit aboard : u.getUnitList()) all.add(menus.unit(aboard.getId()));
                for (Goods g : u.getGoodsList()) {
                    all.add(menus.goods(u.getId(), g.getType().getId(), g.getAmount()));
                }
            }
            for (GoodsType g : client.getGame().getSpecification().getStorableGoodsTypeList()) {
                all.add(menus.goods("europe", g.getId(), 100));
            }
            return all;
        }, true);
        assertEquals(new TreeSet<>(List.of("board", "buy", "clear", "clearSpeciality", "leaveShip",
            "role", "sell", "state", "tradeRoute")), verbs, "every kind of entry was offered and picked");
    }
}
